---
name: Tauri Sidecar
description: Load when configuring the Tauri 2 sidecar that runs the Julia engine in Mathesis — externalBin, target triples, capabilities, shell plugin spawning, stdout NDJSON reading, watchdog, or bundling PackageCompiler apps.
---

# Tauri 2 + Sidecar Julia — patrones

Spec de referencia: https://v2.tauri.app/develop/sidecar/

## 1. Configuración (`src-tauri/tauri.conf.json`)

```jsonc
{
  "bundle": {
    // un binario por target triple: mathesis-engine-x86_64-unknown-linux-gnu,
    // mathesis-engine-x86_64-pc-windows-msvc.exe, mathesis-engine-aarch64-apple-darwin…
    "externalBin": ["binaries/mathesis-engine"]
  }
}
```

Target triple actual: `rustc --print host-tuple`.

## 2. Permisos (`src-tauri/capabilities/default.json`)

```jsonc
{
  "permissions": [
    "core:default",
    "dialog:allow-open", "dialog:allow-save",
    { "identifier": "shell:allow-spawn",
      "allow": [{ "name": "binaries/mathesis-engine", "sidecar": true }] }
  ]
}
```

NUNCA exponer `shell:allow-execute` genérico al frontend.

## 3. Spawn + lector NDJSON (Rust)

```rust
use tauri_plugin_shell::{ShellExt, process::{CommandEvent, Child}};
use tauri_plugin_shell::process::CommandChild;

pub fn spawn_engine(app: &tauri::AppHandle)
    -> anyhow::Result<(mpsc::Receiver<String>, CommandChild)> {
    let cmd = app.shell().sidecar("mathesis-engine")?;
    let (mut rx, child) = cmd.spawn()?;
    Ok((rx, child))
}

// Lectura de stdout línea a línea:
tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(bytes) = event {
            for line in String::from_utf8_lossy(&bytes).lines() {
                // cada línea es una respuesta JSON-RPC → resolver Promise pendiente por id
            }
        }
        if let CommandEvent::Stderr(bytes) = event { /* log */ }
    }
});
```

Escritura al stdin del sidecar: `child.write(b"{\"jsonrpc\":...}\n")`.

## 4. Patrón de cliente RPC (Rust)

```rust
// Peticiones pendientes por id → resolver cuando llegue la línea de stdout
struct RpcClient {
    next_id: AtomicI64,
    pending: Mutex<HashMap<i64, oneshot::Sender<JsonRpcResponse>>>,
}
// tauri::command → enviar petición → await oneshot → devolver result al frontend
```

`tauri::command` puede ser `async` — el frontend recibe una Promise.

## 5. Watchdog

- Heartbeat `ping` cada 30 s; timeout 10 s → muerto
- Reinicio con backoff 1s/2s/4s (máx 3); tras fallo → re-enviar `eval_document`
- Al cerrar app: `shutdown` RPC → SIGTERM → kill a los 2 s

## 6. Build del sidecar Julia

| Entorno | Binario |
|---|---|
| Dev | script Julia (`julia --project=engine engine/src/main.jl`) renombrado o wrapper shell |
| Release | `PackageCompiler.create_app("engine", "dist/engine")` → carpeta relocatable cuyo ejecutable entra como `externalBin` |

CI: construir el app Julia por target + `actions/cache` (20 min la primera vez).
En Windows, PackageCompiler usa clang automaticamente.

## 7. Windows

- `CREATE_NO_WINDOW` para no abrir consola (Tauri lo aplica por defecto al sidecar)
- stdio funciona igual que en Unix; si diera problema → fallback socket local
  (ADR-008 en `Documentacion/02-arquitectura/decisiones-tecnicas.md`)

## 8. Comandos Tauri expuestos al frontend

| Comando | Rol |
|---|---|
| `doc_new` / `doc_open` / `doc_save` | Persistencia JSON |
| `eval_cell` / `eval_document` / `plot_data` | Puente al engine |
| `doc_export` | latex/figure (orchestra; Julia produce) |
| `engine_status` | estado del sidecar |

Los comandos `eval_*` hacen: frontend → invoke → RPC a Julia → Promise → evento.
