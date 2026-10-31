// engine.rs — cliente RPC del sidecar Julia (JSON-RPC 2.0 NDJSON sobre stdio)
//
// - Spawnea `binaries/mathesis-engine-<target-triple>` (wrapper dev → julia).
// - Lee stdout línea a línea, enruta respuestas por `id` a promises pendientes.
// - Notificación "ready" del engine → evento al frontend.
// - Si el engine crashea: se marcan fallidas las pendientes (watchdog: fase 1+).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

const RPC_TIMEOUT: Duration = Duration::from_secs(30);

struct Inner {
    /// `None` = el sidecar no arrancó (error guardado abajo)
    child: Mutex<Option<CommandChild>>,
    /// peticiones pendientes: id → quién espera la respuesta
    pending: Mutex<HashMap<i64, oneshot::Sender<Value>>>,
    next_id: AtomicI64,
    ready: AtomicBool,
    spawn_error: Mutex<Option<String>>,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

impl Engine {
    /// Spawnea el sidecar y arranca la tarea lectora de stdout.
    pub fn spawn(app: &tauri::AppHandle) -> Self {
        let engine = Self {
            inner: Arc::new(Inner {
                child: Mutex::new(None),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicI64::new(0),
                ready: AtomicBool::new(false),
                spawn_error: Mutex::new(None),
            }),
        };

        let spawned = match app.shell().sidecar("mathesis-engine") {
            Ok(cmd) => cmd.spawn(),
            Err(e) => Err(e),
        };

        match spawned {
            Ok((mut rx, child)) => {
                *engine.inner.child.lock().unwrap() = Some(child);
                let inner = Arc::clone(&engine.inner);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let mut buf = String::new();
                    while let Some(event) = rx.recv().await {
                        match event {
                            CommandEvent::Stdout(bytes) => {
                                buf.push_str(&String::from_utf8_lossy(&bytes));
                                // NDJSON: puede llegar trozos parciales o varias líneas
                                while let Some(pos) = buf.find('\n') {
                                    let line: String = buf.drain(..=pos).collect();
                                    Self::handle_line(&handle, &inner, line.trim());
                                }
                            }
                            CommandEvent::Stderr(bytes) => {
                                eprintln!("[engine] {}", String::from_utf8_lossy(&bytes));
                            }
                            CommandEvent::Terminated(status) => {
                                eprintln!("[engine] terminado: {:?}", status);
                                inner.ready.store(false, Ordering::Relaxed);
                                // Fallar todas las peticiones pendientes
                                let mut pending = inner.pending.lock().unwrap();
                                for (_, tx) in pending.drain() {
                                    let _ = tx.send(json!({
                                        "error": {"code": -32000, "message": "engine terminado"}
                                    }));
                                }
                            }
                            _ => {}
                        }
                    }
                });
            }
            Err(e) => {
                eprintln!("[engine] no se pudo spawnear el sidecar: {e}");
                *engine.inner.spawn_error.lock().unwrap() = Some(e.to_string());
            }
        }

        engine
    }

    fn handle_line(app: &tauri::AppHandle, inner: &Arc<Inner>, line: &str) {
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
            // Notificación de hand-shake del engine
            inner.ready.store(true, Ordering::Relaxed);
            let _ = app.emit("engine-ready", msg.get("params").cloned().unwrap_or(Value::Null));
        }
    }

    /// Lanza una petición RPC y espera la respuesta (o timeout).
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        // ¿Hay child?
        {
            let guard = self.inner.child.lock().unwrap();
            if guard.is_none() {
                let err = self
                    .inner
                    .spawn_error
                    .lock()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(|| "sidecar no iniciado".into());
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

        let write_result = {
            let mut guard = self.inner.child.lock().unwrap();
            // as_mut funciona tanto si write toma &self como &mut self
            guard.as_mut().unwrap().write(line.as_bytes())
        };
        if let Err(e) = write_result {
            self.inner.pending.lock().unwrap().remove(&id);
            return Err(format!("no se pudo escribir al engine: {e}"));
        }

        match tokio::time::timeout(RPC_TIMEOUT, rx).await {
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
                Err(format!("timeout ({}s) esperando al engine", RPC_TIMEOUT.as_secs()))
            }
        }
    }

    pub fn status(&self) -> Value {
        let spawn_error = self.inner.spawn_error.lock().unwrap().clone();
        json!({
            "ready": self.inner.ready.load(Ordering::Relaxed),
            "spawnError": spawn_error,
        })
    }
}
