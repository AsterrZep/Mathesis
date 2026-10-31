// engine.rs — cliente RPC del sidecar Julia (JSON-RPC 2.0 NDJSON sobre stdio)
//
// Fase 1 (watchdog + binarios precompilados):
// - Resolución del engine: 1) env MATHESIS_ENGINE · 2) recurso empaquetado
//   (PackageCompiler app en engine-runtime/) · 3) wrapper dev en binaries/.
// - tokio::process en vez de tauri-plugin-shell: spawn/restart natural para
//   el watchdog y CREATE_NO_WINDOW en Windows.
// - Watchdog: ping cada 30 s (timeout 10 s); si muere → reinicio con backoff
//   1s/2s/4s (máx 3) y eventos "engine-status" al frontend.
// - Shutdown limpio al salir: RPC "shutdown" + kill.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::oneshot;

const RPC_TIMEOUT: Duration = Duration::from_secs(30);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);
const PING_TIMEOUT: Duration = Duration::from_secs(10);
const RESTART_MAX_ATTEMPTS: u32 = 3;
const READY_TIMEOUT: Duration = Duration::from_secs(20);

struct Inner {
    app: tauri::AppHandle,
    engine_path: PathBuf,
    /// proceso vivo (None entre reinicios o si el spawn falló)
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    /// peticiones pendientes: id → quién espera la respuesta
    pending: Mutex<HashMap<i64, oneshot::Sender<Value>>>,
    next_id: AtomicI64,
    ready: AtomicBool,
    spawn_error: Mutex<Option<String>>,
    /// intentos de reinicio consecutivos fallidos (watchdog)
    restart_failures: std::sync::atomic::AtomicU32,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

/// Resuelve el ejecutable del engine (release empaquetado o wrapper dev).
fn resolve_engine_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1) Override explícito (desarrollo / debugging)
    if let Ok(p) = std::env::var("MATHESIS_ENGINE") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Ok(pb);
        }
        eprintln!("[engine] MATHESIS_ENGINE={p} no existe, ignorando");
    }

    // 2) Recurso empaquetado (build de release: tauri.conf.json → resources)
    if let Ok(res) = app.path().resource_dir() {
        let exe = res
            .join("engine-runtime")
            .join("bin")
            .join(format!("mathesis-engine{}", std::env::consts::EXE_SUFFIX));
        if exe.exists() {
            return Ok(exe);
        }
    }

    // 3) Dev: wrapper por target-triple en src-tauri/binaries (o en el dir de
    //    build, donde Tauri copia externalBin)
    let name = format!("mathesis-engine-{}", env!("MATHESIS_HOST_TRIPLE"));
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&name),
    ];
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(&name));
    }
    candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
        format!(
            "no se encontró el engine (probado: MATHESIS_ENGINE, recurso \
             engine-runtime/bin/mathesis-engine, binaries/{name})"
        )
    })
}

impl Engine {
    /// Resuelve la ruta, spawnea el proceso y arranca el watchdog.
    pub fn spawn(app: &tauri::AppHandle) -> Self {
        let engine_path = match resolve_engine_path(app) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("[engine] {e}");
                // Spawn solo para dejar constancia del error (sin proceso)
                let engine = Self::new_arc(app.clone(), PathBuf::new());
                *engine.inner.spawn_error.lock().unwrap() = Some(e);
                return engine;
            }
        };

        let engine = Self::new_arc(app.clone(), engine_path.clone());
        // Arranque ASYNC: tokio::process necesita el contexto del reactor,
        // que solo existe dentro de un futuro ejecutado por el runtime
        // (setup corre síncrono en el hilo principal → spawn directo panicaba
        // con "there is no reactor running").
        let starter = engine.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = starter.start_process().await {
                eprintln!("[engine] no se pudo spawnear el sidecar: {e}");
                *starter.inner.spawn_error.lock().unwrap() = Some(e);
            }
        });

        // Watchdog: corazón de la app (Fase 1)
        let wd = engine.clone();
        tauri::async_runtime::spawn(async move { wd.watchdog().await });

        engine
    }

    fn new_arc(app: tauri::AppHandle, engine_path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                app,
                engine_path,
                child: Mutex::new(None),
                stdin: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicI64::new(0),
                ready: AtomicBool::new(false),
                spawn_error: Mutex::new(None),
                restart_failures: std::sync::atomic::AtomicU32::new(0),
            }),
        }
    }

    /// Lanza el proceso y la tarea lectora de stdout (NDJSON).
    /// async SOLO para ejecutarse dentro del contexto del reactor de tokio
    /// (cmd.spawn() es síncrono pero exige reactor en el hilo).
    async fn start_process(&self) -> Result<(), String> {
        if self.inner.engine_path.as_os_str().is_empty() {
            return Err("ruta del engine sin configurar".into());
        }
        let mut cmd = Command::new(&self.inner.engine_path);
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        // Sin consola negra en Windows (el sidecar es TUI-less)
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let stdout = child.stdout.take().ok_or("sin stdout")?;
        let stderr = child.stderr.take().ok_or("sin stderr")?;
        let stdin = child.stdin.take().ok_or("sin stdin")?;

        *self.inner.child.lock().unwrap() = Some(child);
        *self.inner.stdin.lock().unwrap() = Some(stdin);
        self.inner.ready.store(false, Ordering::Relaxed);
        *self.inner.spawn_error.lock().unwrap() = None;

        // Lector de stdout: enruta respuestas por id
        let inner = Arc::clone(&self.inner);
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                Self::handle_line(&inner, &line);
            }
            // EOF: el proceso murió → watchdog lo reiniciará
            inner.ready.store(false, Ordering::Relaxed);
            let mut pending = inner.pending.lock().unwrap();
            for (_, tx) in pending.drain() {
                let _ = tx.send(json!({
                    "error": {"code": -32000, "message": "engine terminado"}
                }));
            }
            drop(pending);
            let _ = inner.app.emit(
                "engine-status",
                json!({ "ready": false, "reason": "terminated" }),
            );
        });

        // stderr → log de la app
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[engine] {line}");
            }
        });

        Ok(())
    }

    fn handle_line(inner: &Arc<Inner>, line: &str) {
        if line.is_empty() {
            return;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("[rpc] línea no JSON ({e}): {line}");
                return;
            }
        };

        if let Some(id) = msg.get("id").and_then(|v| v.as_i64()) {
            // Respuesta → resolver la promise pendiente
            if let Some(tx) = inner.pending.lock().unwrap().remove(&id) {
                let _ = tx.send(msg);
            }
        } else if msg.get("method").and_then(|v| v.as_str()) == Some("ready") {
            // Hand-shake del engine
            inner.ready.store(true, Ordering::Relaxed);
            let _ = inner.app.emit(
                "engine-ready",
                msg.get("params").cloned().unwrap_or(Value::Null),
            );
        }
    }

    // ── Watchdog (Fase 1) ──────────────────────────────────────────────────

    async fn watchdog(&self) {
        loop {
            tokio::time::sleep(HEARTBEAT_INTERVAL).await;
            if self.inner.engine_path.as_os_str().is_empty() {
                continue; // nunca arrancó bien: no hay nada que vigilar
            }
            let alive = self.inner.child.lock().unwrap().is_some();
            if !alive {
                self.restart_with_backoff("proceso ausente").await;
                continue;
            }
            // Latido: si no responde en 10 s, se considera muerto
            match self
                .call_with_timeout("ping", json!({}), PING_TIMEOUT)
                .await
            {
                Ok(_) => {
                    self.inner
                        .restart_failures
                        .store(0, Ordering::Relaxed);
                }
                Err(e) => {
                    eprintln!("[engine] watchdog: ping falló ({e})");
                    self.kill_process();
                    self.restart_with_backoff(&e).await;
                }
            }
        }
    }

    /// Reinicia con backoff 1s/2s/4s (máx. 3 intentos); emite engine-ready.
    async fn restart_with_backoff(&self, cause: &str) {
        eprintln!("[engine] watchdog: reiniciando ({cause})");
        let _ = self.inner.app.emit(
            "engine-status",
            json!({ "ready": false, "reason": "restarting", "cause": cause }),
        );
        for attempt in 1..=RESTART_MAX_ATTEMPTS {
            tokio::time::sleep(Duration::from_secs(1 << (attempt - 1))).await;
            self.kill_process();
            if let Err(e) = self.start_process().await {
                eprintln!("[engine] reintento {attempt}: spawn falló ({e})");
                continue;
            }
            // Esperar el hand-shake "ready"
            let deadline = tokio::time::Instant::now() + READY_TIMEOUT;
            while !self.inner.ready.load(Ordering::Relaxed)
                && tokio::time::Instant::now() < deadline
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if self.inner.ready.load(Ordering::Relaxed) {
                eprintln!("[engine] watchdog: engine restaurado (intento {attempt})");
                self.inner.restart_failures.store(0, Ordering::Relaxed);
                let _ = self.inner.app.emit(
                    "engine-status",
                    json!({ "ready": true, "reason": "restarted" }),
                );
                return;
            }
            eprintln!("[engine] reintento {attempt}: sin hand-shake");
        }
        let fails = self.inner.restart_failures.fetch_add(1, Ordering::Relaxed) + 1;
        eprintln!("[engine] watchdog: {fails} fallos consecutivos de reinicio");
        let _ = self.inner.app.emit(
            "engine-status",
            json!({ "ready": false, "reason": "dead", "failures": fails }),
        );
    }

    fn kill_process(&self) {
        if let Some(mut child) = self.inner.child.lock().unwrap().take() {
            let _ = child.start_kill();
        }
        *self.inner.stdin.lock().unwrap() = None;
        self.inner.ready.store(false, Ordering::Relaxed);
    }

    /// Apagado ordenado al salir de la app: RPC shutdown + kill.
    pub fn shutdown_blocking(&self) {
        if self.inner.child.lock().unwrap().is_none() {
            return;
        }
        let _ = tauri::async_runtime::block_on(async {
            tokio::time::timeout(
                Duration::from_secs(2),
                self.call_with_timeout("shutdown", json!({}), Duration::from_secs(2)),
            )
            .await
        });
        self.kill_process();
    }

    // ── RPC ────────────────────────────────────────────────────────────────

    /// Lanza una petición RPC y espera la respuesta (o timeout).
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.call_with_timeout(method, params, RPC_TIMEOUT).await
    }

    async fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        // ¿Hay proceso vivo?
        {
            let guard = self.inner.child.lock().unwrap();
            if guard.is_none() {
                let err = self
                    .inner
                    .spawn_error
                    .lock()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(|| "sidecar no iniciado (¿reiniciando?)".into());
                return Err(format!("motor matemático no disponible: {err}"));
            }
        }

        let id = self.inner.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.inner.pending.lock().unwrap().insert(id, tx);

        let req = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        let line = format!("{req}\n");

        // take/put-back: el MutexGuard de std no puede cruzar el await (Send)
        let mut stdin_slot = self.inner.stdin.lock().unwrap().take();
        let write_result = match stdin_slot.as_mut() {
            Some(stdin) => stdin.write_all(line.as_bytes()).await,
            None => {
                self.inner.pending.lock().unwrap().remove(&id);
                return Err("stdin del engine no disponible".into());
            }
        };
        *self.inner.stdin.lock().unwrap() = stdin_slot;
        if let Err(e) = write_result {
            self.inner.pending.lock().unwrap().remove(&id);
            return Err(format!("no se pudo escribir al engine: {e}"));
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(resp)) => {
                if let Some(err) = resp.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("error RPC")
                        .to_string();
                    return Err(msg);
                }
                Ok(resp.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Err(_)) => {
                self.inner.pending.lock().unwrap().remove(&id);
                Err("engine terminado durante la petición".into())
            }
            Err(_) => {
                self.inner.pending.lock().unwrap().remove(&id);
                Err(format!("timeout ({}s) esperando al engine", timeout.as_secs()))
            }
        }
    }

    pub fn status(&self) -> Value {
        let spawn_error = self.inner.spawn_error.lock().unwrap().clone();
        json!({
            "ready": self.inner.ready.load(Ordering::Relaxed),
            "spawnError": spawn_error,
            "enginePath": self.inner.engine_path.to_string_lossy(),
        })
    }
}
