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

## 3. Spawn + lector NDJSON (Rust) — ✅ implementado (tokio::process)

`src-tauri/src/engine.rs` NO usa tauri-plugin-shell: spawnea con
`tokio::process::Command` (restart natural para el watchdog + `kill_on_drop`
+ `CREATE_NO_WINDOW` en Windows). Resolución de la ruta del engine:

1. `MATHESIS_ENGINE` (env, override de dev/debug)
2. Recurso empaquetado: `resource_dir()/engine-runtime/bin/mathesis-engine[.exe]` (release)
3. Dev: `src-tauri/binaries/mathesis-engine-<TARGET_TRIPLE>` (wrapper bash con
   juliaup; el triple se inyecta vía `build.rs` → `MATHESIS_HOST_TRIPLE`)

Lector de stdout: `BufReader::new(stdout).lines()` en un task de
`tauri::async_runtime::spawn`; cada línea JSON enruta la respuesta por `id`
al `oneshot` pendiente. EOF de stdout ⇒ proceso muerto ⇒ el watchdog reinicia.
Escritura: `ChildStdin` guardado en `Mutex<Option<ChildStdin>>` — tomarlo con
`.take()`, escribir (await) y devolverlo (el MutexGuard de std NO puede cruzar
un await: rompe `Send`).

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
