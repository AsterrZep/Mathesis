// Mathesis — núcleo Tauri
// Comandos expuestos al frontend + ciclo de vida del sidecar Julia.
mod engine;
mod mmt;

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

/// Importa un documento `.mmt` (XML del microMathematics original) → JSON v1.
/// Devuelve { path, doc, warnings } — NO escribe disco: el frontend carga con
/// loadDoc(null, …) y el usuario guarda como JSON cuando quiera.
/// Frontend: invoke("doc_import") → {path, doc, warnings} | null
#[tauri::command]
async fn doc_import(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Documento microMathematics (.mmt)", &["mmt", "xml"])
        .pick_file(move |p| {
            let _ = tx.send(p);
        });
    let Some(fp) = rx.await.ok().flatten() else {
        return Ok(None);
    };
    let path = fp.to_string();
    let text = std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer: {e}"))?;
    let imported = mmt::import_mmt(&text).map_err(|e| format!("Error importando .mmt: {e}"))?;
    Ok(Some(serde_json::json!({
        "path": path,
        "doc": imported.doc,
        "warnings": imported.warnings,
    })))
}

/// Guarda un artefacto generado en el FRONTEND (PNG/SVG de figuras, Fase 2)
/// con diálogo "Guardar como" nativo. `b64=true` → content es base64 (PNG).
/// Frontend: invoke("save_artifact", { filename, ext, content, b64 })
#[tauri::command]
async fn save_artifact(
    app: tauri::AppHandle,
    filename: String,
    ext: String,
    content: String,
    b64: bool,
) -> Result<Option<String>, String> {
    use base64::Engine as _;
    let bytes: Vec<u8> = if b64 {
        base64::engine::general_purpose::STANDARD
            .decode(content.as_bytes())
            .map_err(|e| format!("base64 inválido: {e}"))?
    } else {
        content.into_bytes()
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(format!("Gráfico {ext}"), &[ext.as_str()])
        .set_file_name(&filename)
        .save_file(move |p| {
            let _ = tx.send(p.map(|f| f.to_string()));
        });
    let Some(target) = rx.await.ok().flatten() else {
        return Ok(None); // cancelado
    };
    std::fs::write(&target, &bytes).map_err(|e| format!("No se pudo escribir: {e}"))?;
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
            doc_import,
            doc_export,
            save_artifact,
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
