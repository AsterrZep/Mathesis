// Mathesis — núcleo Tauri
// Comandos expuestos al frontend + ciclo de vida del sidecar Julia.
mod engine;

use serde_json::Value;
use tauri::Manager;

/// Evalúa una celda del worksheet vía el motor Julia.
/// Frontend: invoke("eval_cell", { cellId, ast, env })
#[tauri::command]
async fn eval_cell(
    engine: tauri::State<'_, engine::Engine>,
    cell_id: String,
    ast: Value,
    env: Value,
) -> Result<Value, String> {
    let resp = engine
        .call(
            "eval_cell",
            serde_json::json!({ "cellId": cell_id, "ast": ast, "env": env }),
        )
        .await?;
    // result.status = "error" NO es error RPC: lo devolvemos tal cual para que
    // la UI pinte el error en la celda (ver protocolo-ipc.md).
    Ok(resp)
}

/// Estado del sidecar: { ready, spawnError }
#[tauri::command]
fn engine_status(engine: tauri::State<'_, engine::Engine>) -> Value {
    engine.status()
}

/// Heartbeat sencillo (fase 1+ lo usará el watchdog)
#[tauri::command]
async fn ping_engine(engine: tauri::State<'_, engine::Engine>) -> Result<Value, String> {
    engine.call("ping", serde_json::json!({})).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // El sidecar se spawnea al arrancar la app y vive con ella.
            let handle = app.handle().clone();
            let engine = engine::Engine::spawn(&handle);
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            eval_cell,
            engine_status,
            ping_engine
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
