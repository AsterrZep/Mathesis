// Mathesis — núcleo Tauri
// Comandos expuestos al frontend + ciclo de vida del sidecar Julia.
mod engine;

use serde_json::Value;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// Evalúa una celda aislada — el documento completo usa eval_document.
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

/// Evalúa el documento COMPLETO en orden (Fase 1): variables y funciones de
/// usuario se propagan entre celdas.
/// `changedCellIds` (opcional) → evaluación incremental: solo re-evalúa las
/// celdas afectadas y las que dependen de ellas (grafo en el engine).
/// `settings.digits` (opcional) → dígitos significativos del formato.
/// Frontend: invoke("eval_document", { cells, changedCellIds?, settings? })
#[tauri::command]
async fn eval_document(
    engine: tauri::State<'_, engine::Engine>,
    cells: Vec<Value>,
    changed_cell_ids: Option<Vec<String>>,
    settings: Option<Value>,
) -> Result<Value, String> {
    engine
        .call(
            "eval_document",
            serde_json::json!({
                "cells": cells,
                "changedCellIds": changed_cell_ids,
                "settings": settings,
            }),
        )
        .await
}

/// Muestrea una expresión (x libre) para el gráfico del inspector (uPlot).
/// Frontend: invoke("plot_data", { ast, xFrom, xTo, steps, varName, env })
#[tauri::command]
async fn plot_data(
    engine: tauri::State<'_, engine::Engine>,
    ast: Value,
    x_from: f64,
    x_to: f64,
    steps: u32,
    var_name: String,
    env: Value,
) -> Result<Value, String> {
    engine
        .call(
            "plot_data",
            serde_json::json!({
                "ast": ast, "xFrom": x_from, "xTo": x_to,
                "steps": steps, "varName": var_name, "env": env
            }),
        )
        .await
}

/// Guarda el documento JSON. Con `path` → sobrescribe; sin path → diálogo
/// "Guardar como" nativo. Devuelve la ruta elegida (null si canceló).
/// Frontend: invoke("doc_save", { path, doc })
#[tauri::command]
async fn doc_save(
    app: tauri::AppHandle,
    path: Option<String>,
    doc: Value,
) -> Result<Option<String>, String> {
    let json = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
    let target = match path {
        Some(p) => p,
        None => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog()
                .file()
                .add_filter("Documento Mathesis", &["math.json", "json"])
                .set_file_name("Untitled.math.json")
                .save_file(move |p| {
                    let _ = tx.send(p.map(|f| f.to_string()));
                });
            match rx.await {
                Ok(Some(p)) => p,
                _ => return Ok(None), // cancelado
            }
        }
    };
    std::fs::write(&target, &json).map_err(|e| format!("No se pudo guardar: {e}"))?;
    Ok(Some(target))
}

/// Abre un documento JSON con el diálogo nativo.
/// Frontend: invoke("doc_open") → { path, doc } | null
#[tauri::command]
async fn doc_open(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Documento Mathesis", &["math.json", "json"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let Some(fp) = rx.await.ok().flatten() else {
        return Ok(None);
    };
    let path = fp.to_string();
    let text = std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    let doc: Value = serde_json::from_str(&text).map_err(|e| format!("JSON inválido: {e}"))?;
    Ok(Some(serde_json::json!({ "path": path, "doc": doc })))
}

/// Exporta el documento (Fase 2: latex) — el engine produce el contenido
/// con sus resultados y Rust lo guarda vía diálogo "Guardar como" nativo.
/// Frontend: invoke("doc_export", { kind: "latex", doc }) → path | null
#[tauri::command]
async fn doc_export(
    app: tauri::AppHandle,
    engine: tauri::State<'_, engine::Engine>,
    kind: String,
    path: Option<String>,
    doc: Value,
) -> Result<Option<String>, String> {
    let result = engine
        .call("export", serde_json::json!({ "kind": kind, "doc": doc }))
        .await?;
    let content = result
        .get("content")
        .and_then(|c| c.as_str())
        .ok_or_else(|| "el engine no devolvió contenido".to_string())?;
    let filename = result
        .get("filename")
        .and_then(|f| f.as_str())
        .unwrap_or("documento.tex")
        .to_string();

    let target = match path {
        Some(p) => p,
        None => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog()
                .file()
                .add_filter("LaTeX", &["tex"])
                .set_file_name(&filename)
                .save_file(move |p| {
                    let _ = tx.send(p.map(|f| f.to_string()));
                });
            match rx.await {
                Ok(Some(p)) => p,
                _ => return Ok(None), // cancelado
            }
        }
    };
    std::fs::write(&target, content).map_err(|e| format!("No se pudo escribir: {e}"))?;
    Ok(Some(target))
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
    // Ventana NEGRO en GPUs antiguas/software: WebKitGTK con compositing no
    // pinta en algunos drivers (M-3). Lo desactivamos por defecto; el usuario
    // puede forzar cualquier valor exportando WEBKIT_DISABLE_COMPOSITING_MODE.
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        // set_var: seguro aquí (arranque, antes de spawnear hilos)
        unsafe { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1") };
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // El sidecar se spawnea al arrancar la app y vive con ella
            // (watchdog en engine.rs lo vigila y reinicia).
            let handle = app.handle().clone();
            let engine = engine::Engine::spawn(&handle);
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            eval_cell,
            eval_document,
            plot_data,
            doc_save,
            doc_open,
            doc_export,
            engine_status,
            ping_engine
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|handle, event| {
        // Apagado ordenado del engine al salir (Fase 1: shutdown + kill)
        if let tauri::RunEvent::Exit = event
            && let Some(engine) = handle.try_state::<engine::Engine>()
        {
            engine.shutdown_blocking();
        }
    });
}
