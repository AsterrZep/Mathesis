# Stack: Rust + Tauri 2

## Versión mínima

- Rust 1.77+ (instalado: **1.97.1** ✅)
- Tauri **2.x** (estable, con soporte sidecar maduro)

## Crates principales

| Crate | Rol |
|---|---|
| `tauri` 2.x | Framework de app de escritorio |
| `tauri-plugin-shell` | Spawn del sidecar Julia (`externalBin`) |
| `tauri-plugin-dialog` | Diálogos nativos (abrir/guardar archivo) |
| `tauri-plugin-fs` | Lectura/escritura de archivos (con capabilities) |
| `tauri-plugin-opener` | Abrir enlaces/navegador |
| `tauri-plugin-updater` | Auto-actualización (fase 4) |
| `serde` / `serde_json` | Serialización JSON (documento + IPC) |
| `tokio` | Async runtime (Tauri ya lo trae; para tasks del sidecar) |
| `quick-xml` | Parser del importador `.mmt` (fase 2) |
| `thiserror` | Errores tipados |
| `tracing` + `tracing-subscriber` | Logging estructurado |
| `uuid` | Ids de celdas |

## Estructura del proyecto (propuesta)

```
mathesis/
├── src-tauri/                    ← Rust (núcleo)
│   ├── Cargo.toml
│   ├── tauri.conf.json           ← ventana, externalBin, capabilities
│   ├── capabilities/default.json
│   ├── binaries/                 ← sidecars Julia por target triple
│   │   ├── mathesis-engine-x86_64-unknown-linux-gnu
│   │   ├── mathesis-engine-x86_64-pc-windows-msvc.exe
│   │   └── mathesis-engine-aarch64-apple-darwin
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── engine/               ← gestión del sidecar
│       │   ├── mod.rs            ← spawn + watchdog
│       │   ├── rpc.rs            ← cliente JSON-RPC (stdio)
│       │   └── protocol.rs       ← tipos serde del protocolo
│       ├── commands/             ← #[tauri::command]
│       │   ├── doc.rs            ← new/open/save/export
│       │   ├── eval.rs           ← eval_cell/eval_document
│       │   └── import.rs         ← importador .mmt (fase 2)
│       └── doc/
│           ├── model.rs          ← estructura del documento JSON
│           └── mmt.rs            ← parser XML .mmt (fase 2)
├── src/                          ← Frontend (React+TS)
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── Worksheet.tsx         ← contenedor de celdas
│   │   ├── cells/
│   │   │   ├── EquationCell.tsx
│   │   │   ├── TextCell.tsx
│   │   │   ├── PlotCell.tsx
│   │   │   └── ImageCell.tsx
│   │   ├── editor/MathField.tsx  ← wrapper de MathLive
│   │   ├── plot/Plot2D.tsx       ← uPlot wrapper
│   │   └── palette/SymbolPalette.tsx
│   ├── state/
│   │   ├── document.ts           ← Zustand store del documento
│   │   ├── engine.ts             ← cliente IPC (invoke wrapper)
│   │   └── undo.ts               ← pila undo/redo
│   ├── mathjson/                 ← helpers MathJSON (getLatex, traverse…)
│   └── styles/
├── engine/                       ← Julia (sidecar)
│   ├── Project.toml
│   ├── src/
│   │   ├── MathesisEngine.jl     ← módulo principal + loop RPC
│   │   ├── rpc.jl                ← servidor JSON-RPC NDJSON
│   │   ├── mathjson.jl           ← MathJSON → Symbolics
│   │   ├── env.jl                ← entorno del documento (vars/funcs)
│   │   ├── units.jl              ← Unitful integration
│   │   ├── plot.jl               ← datos de gráficos + CairoMakie export
│   │   └── export/latex.jl       ← export LaTeX del documento
│   └── test/
├── package.json                  ← frontend deps
└── Documentacion/
```

## `tauri.conf.json` — fragmento clave

```json
{
  "productName": "Mathesis",
  "version": "0.1.0",
  "identifier": "com.mathesis.app",
  "app": {
    "windows": [{
      "title": "Mathesis",
      "width": 1280, "height": 800,
      "minWidth": 800, "minHeight": 600
    }],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "externalBin": ["binaries/mathesis-engine"],
    "active": true,
    "targets": ["msi", "nsis", "app", "deb", "rpm", "appimage"]
  }
}
```

## Seguridad (capabilities)

- `core:default`
- `dialog:allow-open`, `dialog:allow-save`
- `fs:allow-read-text-file`, `fs:allow-write-text-file` (scope: documentos)
- `shell:allow-spawn` solo para el sidecar declarado
- **NO** exponer `shell:allow-execute` genérico al frontend

## Comandos Tauri (API frontend ⇄ Rust)

| Comando | Firma | Rol |
|---|---|---|
| `doc_new` | `() → Document` | Documento vacío |
| `doc_open` | `path → Document` | Cargar `.mmj.json` o `.mmt` (auto-detect) |
| `doc_save` | `(path, doc) → ()` | Guardar JSON |
| `doc_export` | `(kind, doc, path) → ()` | latex/figure/mathjax vía engine |
| `eval_document` | `doc → CellResult[]` | Evaluación completa |
| `eval_cell` | `(ast, env, cellId) → CellResult` | Evaluación incremental |
| `plot_data` | `(spec) → PlotData` | Datos de gráfico |
| `engine_status` | `() → {alive, version}` | Estado del sidecar |

## Build y CI

- Dev: `cargo tauri dev` (arranca Vite + Rust + sidecar en dev)
- Build: `cargo tauri build` → instaladores por plataforma
- CI recomendada: GitHub Actions con matrix (ubuntu/windows/macos) +
  `tauri-apps/tauri-action`
- El sidecar Julia se construye en CI con `PackageCompiler.create_app`
  (cache del sysimage con actions/cache — tarda ~10-20 min la primera vez)

## Tamaño estimado del binario Rust

- Debug: ~30 MB · Release: ~3–8 MB (Tauri es minimalista comparado con Electron)
