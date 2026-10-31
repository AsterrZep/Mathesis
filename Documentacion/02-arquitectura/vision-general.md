# Visión general de la arquitectura

## Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                     APLICACIÓN DE ESCRITORIO                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              VENTANA TAURI (webview)                      │  │
│  │                                                           │  │
│  │  ┌───────────────────── React + TS ─────────────────────┐ │  │
│  │  │                                                       │ │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │ │  │
│  │  │  │ Worksheet│  │ MathLive │  │ Panel de gráficos │  │ │  │
│  │  │  │ (celdas) │  │ (editor) │  │  (uPlot / WebGL)  │  │ │  │
│  │  │  └──────────┘  └──────────┘  └───────────────────┘  │ │  │
│  │  │  ┌──────────────────────────────────────────────┐   │ │  │
│  │  │  │ Zustand store (estado del documento JSON)     │   │ │  │
│  │  │  └──────────────────────────────────────────────┘   │ │  │
│  │  └───────────────────────┬─────────────────────────────┘ │  │
│  └──────────────────────────┼───────────────────────────────┘  │
│                             │ @tauri-apps/api (invoke/events)   │
│  ┌──────────────────────────┼───────────────────────────────┐  │
│  │         NÚCLEO RUST (src-tauri)                          │  │
│  │                                                           │  │
│  │  • Comandos Tauri (evaluate, save, load, export…)         │  │
│  │  • Gestión del proceso sidecar Julia                      │  │
│  │  • IPC JSON-RPC (stdio) con el sidecar                    │  │
│  │  • Persistencia de documentos (.json, import .mmt)        │  │
│  │  • Diálogos nativos, tema, preferencias                   │  │
│  │  • Watchdog: reinicio del sidecar si crashea              │  │
│  └──────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │  stdin/stdout (JSON-RPC 2.0, NDJSON)
                              │  (o socket local en Windows)
┌─────────────────────────────┼───────────────────────────────────┐
│         PROCESO SIDECAR JULIA                                  │
│                                                                 │
│  Motor matemático completo:                                     │
│  • Parser MathJSON → expresiones Julia                          │
│  • Symbolics.jl   (álgebra simbólica: simplificar, derivar)     │
│  • Unitful.jl     (unidades SI + no-SI, conversión)             │
│  • FFTW.jl        (FFT)                                         │
│  • QuadGK / DiffEq (integrales numéricas, ODEs — fase 3)        │
│  • CairoMakie     (render de gráficos → SVG/PNG/PDF export)     │
│  • Entorno de variables/funciones del documento                 │
│  • Sysimage PackageCompiler.jl (arranque < 2 s)                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Principios de diseño (máxima eficiencia + ligereza)

1. **Un solo proceso Julia por la app** (no por ventana). Se arranca al abrir la
   app (o de forma lazy al primer cálculo) y vive mientras la app vive. El
   arranque lento de Julia se mitiga con **sysimage de PackageCompiler**.

2. **El cálculo nunca se bloquea la UI** — Rust envía la petición a Julia y
   devuelve un `Promise` al frontend; mientras, la UI sigue interactiva. Si
   Julia tarda, se muestra spinner en la celda.

3. **El frontend NO calcula matemática** — solo renderiza. Julia es la única
   autoridad matemática (evita duplicación y bugs de consistencia).

4. **Rust NO calcula matemática** — solo orquesta. (Excepto lecturas triviaales
   si se quisiera modo offline de emergencia — no en MVP.)

5. **Gráficos interactivos = datos de Julia + dibujo en el frontend** — Julia
   devuelve arreglos `(x, y)` (o mallas 3D), el frontend dibuja con canvas/WebGL
   (uPlot para 2D, très.js/regl para 3D). Zoom/pan no tocan Julia (latencia 0).

6. **Exportación de calidad = CairoMakie en Julia** — para PNG/SVG/PDF
   "de publicación" y para LaTeX, Julia renderiza con CairoMakie (calidad
   vectorial pura, mejor que cualquier canvas). Ver ADR-003.

7. **Formato de documento JSON versionado** — el estado canónico vive en
   JSON (Rust lo persiste, Julia lo recibe serializado). El AST de las
   fórmulas usa **MathJSON** (estándar de MathLive) para máxima compatibilidad
   con el ecosistema.

8. **Aislamiento de fallos** — si Julia crashea, Rust reinicia el sidecar y
   re-evalúa el documento. La app nunca muere por un error matemático.

## Protocolo IPC (resumen — ver `protocolo-ipc.md`)

- **JSON-RPC 2.0** sobre **stdio** (NDJSON: un mensaje JSON por línea)
- Ventajas: cero dependencias de red, funciona en los 3 SO, fácil de testear
  (puedes hablar con el sidecar desde la terminal)
- Fallback en Windows si stdio diera problemas: socket TCP en `localhost:puerto`

## Ciclo de vida

```
App arranca
  └─► Rust spawnea sidecar Julia (binario embebido vía Tauri externalBin)
        └─► Julia carga sysimage (≈1-2 s) y manda {"method":"ready"}
  └─► Frontend carga documento JSON (último abierto o nuevo)
  └─► Rust envía {"method":"eval_document", params:{doc}}
  └─► Julia evalúa celda por celda en orden, devuelve resultados[]
  └─► Frontend pinta resultados

Usuario edita una celda (debounce 300 ms)
  └─► Frontend envía al store → Rust → {"method":"eval_incremental", params:{cellId, ast}}
  └─► Julia re-evalúa solo lo afectado (y dependientes)
  └─► Devuelve resultado de la celda → UI se actualiza
```
