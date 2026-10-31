# Decisiones técnicas (ADR — Architecture Decision Records)

## ADR-001: Julia como proceso sidecar, no embebida

**Estado:** Aceptado
**Contexto:** Julia debe formar parte de una app Tauri. Opciones: jlrs (embebida),
proceso separado, o servidor HTTP.

**Decisión:** Proceso sidecar comunicado por **JSON-RPC 2.0 sobre stdio**
(NDJSON). Tauri 2 tiene soporte oficial de sidecars (`externalBin` +
`tauri-plugin-shell`).

**Consecuencias:**
- ✅ Crash de Julia no mata la app (watchdog la reinicia)
- ✅ Testable desde terminal (hablar JSON por stdin al binario Julia)
- ✅ `PackageCompiler.create_app` genera bundle relocatable por arquitectura
- ⚠️ Overhead de serialización (despreciable: µs vs ms de cómputo)
- ⚠️ Build de CI más complejo (3 targets × sysimage Julia)

---

## ADR-002: React + TypeScript + Vite para el frontend

**Estado:** Aceptado
**Contexto:** UI de worksheet matemática 2D muy interactiva.

**Decisión:** React 19 + TypeScript estricto + Vite. Editor matemático con
**MathLive** (web component). Estado global con **Zustand**.

**Alternativas descartadas:**
- Svelte: bueno pero MathLive integra mejor con React; ecosistema de ejemplos
- Vanilla TS: demasiado trabajo manual para el árbol de celdas
- Vue/Solid: sin ventaja decisiva aquí

**Consecuencias:**
- ✅ MathLive da el editor 2D "tipo MathCAD" casi gratis (LaTeX in/out, MathJSON)
- ✅ Vite = HMR instantáneo en desarrollo
- ✅ Zustand = estado minimal (sin boilerplate Redux)

---

## ADR-003: Gráficos — Híbrido uPlot/WebGL (interactivo) + CairoMakie (export)

**Estado:** Aceptado
**Contexto:** Pregunta del usuario: *"¿no se puede usar CairoMakie?"*. Análisis
de los backends de Makie y alternativas JS:

### Backends de Makie.jl

| Backend | Qué hace | ¿Sirve aquí? |
|---|---|---|
| **CairoMakie** | Render **CPU vectorial** → SVG/PDF/PNG. Calidad de publicación. Sin GPU. **No interactivo** (es un render estático). | ✅ **SÍ, para EXPORTAR** (PNG/SVG/PDF de calidad, y figuras para LaTeX). Es perfecto para el sidecar: headless, sin GPU, determinista. |
| **WGLMakie** | Render en el **navegador** vía ThreeJS+WebGL. Requiere sesión Julia viva (Bonito + WebSocket) por cada plot. | ❌ Para la vista interactiva: obligaría a mantener un servidor Julia+Bonito activo, un WebSocket por gráfico, y la UI quedaría atada a Julia en cada hover/zoom. Más peso, más latencia, acoplamiento total. |
| **GLMakie** | GPU nativa (OpenGL) en ventana propia | ❌ No embebible en la webview de Tauri |
| **RPRMakie** | Ray tracing (ProRender) | ❌ Overkill |

### Alternativas JS para la vista interactiva

| Lib | Peso (gzip) | 2D | 3D | Interactividad |
|---|---|---|---|---|
| **uPlot** | ~45 KB | ✅ excelente (canvas, 1M pts) | ❌ | zoom/pan/tooltip nativos, sin Julia |
| **Plotly.js** | ~1 MB+ | ✅ | ✅ | completa, pesado |
| **Three.js / regl** | ~150 KB | (general) | ✅ | completa, más código propio |
| **D3** | ~80 KB | ✅ | parcial | manual |

### Decisión

1. **Vista interactiva en pantalla**: Julia calcula los **datos** (arrays x, y /
   mallas z) y los manda por IPC. El frontend dibuja con **uPlot** (2D) o
   **Three.js** (3D, fase 3). Zoom/pan/resize son **locales al frontend** — cero
   idas a Julia, latencia 0, se siente nativo.
2. **Exportación** (PNG/SVG/PDF del documento, figuras para LaTeX): **CairoMakie**
   en el sidecar. Calidad vectorial pura, mejor que cualquier canvas, y sale
   gratis porque CairoMakie es headless-friendly (perfecto para un sidecar sin
   display).
3. Makie (CairoMakie) y uPlot comparten **estilo vía tema JSON** para que el
   gráfico exportado parezca el de pantalla.

**Conclusión sobre la pregunta:** Sí, **CairoMakie se usa** — pero para
exportación de máxima calidad, NO para la vista interactiva (ese rol es de
uPlot/WebGL en el frontend, que es más ligero e interactivo sin Julia viva).
Es el mejor de los dos mundos: calidad de publicación + interactividad nativa.

> **⚡ Revisión (31-oct-2026, Fase 2):** el punto 2 queda **deferido**.
> El usuario priorizó el **rendimiento en equipos de pocos recursos** (tras el
> feedback de la laptop con la v0.1.0): empaquetar CairoMakie añadiría
> ≈200-400 MB al sysimage, subiría arranque/RSS y complicaría el CI, para
> dibujar figuras 2D que ya son solo datos x/y. **Implementado en su lugar:**
> exportación de figuras **PNG/SVG desde el frontend** (`src/exportChart.ts` —
> SVG de polilíneas+ejes+rejilla+leyenda generado de los datos de `plot_data`,
> PNG = rasterizado 2× del mismo SVG; un solo renderer = coherente con lo que
> se ve). CairoMakie queda pendiente de **medición en Fase 4** y solo si se
> necesita export **headless** (servidor/CLI) o el render completo del
> documento. El punto 1 (uPlot interactivo) sigue tal cual.

---

## ADR-004: Formato de documento JSON propio + importador `.mmt`

**Estado:** Aceptado
**Contexto:** El original usa XML (`xmlns:mmt`). Compatibilidad total vs
libertad.

**Decisión:** Formato **JSON propio** (`*.mmj.json` o extensión propia) con:
- Raíz: `version`, `meta`, `settings`, `cells[]`
- AST de fórmulas en **MathJSON** (estándar abierto de MathLive)
- Importador de `.mmt` (XML) en Rust (fase 2+)

**Consecuencias:**
- ✅ JSON es nativo en Rust (serde), Julia (JSON3) y TS — sin parser XML en Julia
- ✅ MathJSON permite reutilizar MathLive como editor y Symbolics como backend
  con traducción directa
- ✅ Diff-able en git, migrable con `version`
- ⚠️ Los usuarios del original necesitan el importador (aceptado)

---

## ADR-005: MathJSON como AST intermedio

**Estado:** Aceptado
**Contexto:** MathLive produce/consume **MathJSON** (estándar abierto):
`["Add", ["Power", "x", 2], 1]`. Julia necesita evaluarlo.

**Decisión:** El documento guarda las fórmulas en MathJSON. El sidecar Julia
incluye un **traductor MathJSON → Symbolics.jl** (es un parser de ~300 líneas:
recorrer arrays anidados y mapear `Add→+`, `Power→^`, `Sin→sin`…). Para
funciones no cubiertas por Symbolics, se extiende el diccionario.

**Consecuencias:**
- ✅ Estándar abierto, no inventamos lenguaje de fórmulas
- ✅ Si mañana cambiamos MathLive, el formato del documento no cambia
- ✅ MathJSON tiene librería estándar rica (ver referencia en `03-tecnologias/frontend.md`)

---

## ADR-006: Licencia — GPL-3.0

**Estado:** ✅ Aceptado (30-oct-2026 — decisión del usuario)
**Contexto:** microMathematics es GPL-3.0. No copiamos código (reimplementamos),
así que la licencia es en principio libre.

**Decisión: GNU GPL-3.0** — elección voluntaria del usuario pese a no estar
obligado, coherente con el espíritu open-source del proyecto y con el original.
Archivo `LICENSE` en la raíz del repo.

**Opciones:**
| Opción | Ventaja | Riesgo |
|---|---|---|
| GPL-3.0 | Alineado con el original, comunidad OSS | Productos cerrados no pueden incorporarlo |
| MIT / Apache-2.0 dual | Máxima adopción | Si algún día se copia código del original → incompatible |
| AGPL-3.0 | Protege también el uso como servicio web | Menos adopción |

**Criterio de decisión:** Antes del primer release público. Si se usa cualquier
fragmento del original (incluso ideas traducidas literalmente del XML de
ejemplos), **la GPL-3.0 es obligatoria**. Recomendación preliminar: **GPL-3.0
o Apache-2.0 dual** — pero decidir con calma en fase 2.

---

## ADR-007: Empaquetado del sidecar Julia

**Estado:** Aceptado (plan)
**Contexto:** Los usuarios no deben instalar Julia.

**Decisión:**
- Desarrollo: sidecar = script Julia + `juliaup` del dev (arranque 8-15 s, OK
  en dev con Revise.jl para hot-reload del motor)
- Release: **`PackageCompiler.create_app`** → carpeta relocatable con Julia
  + sysimage precompilado. Tauri la incluye vía `externalBin` (con sufijo
  `-$TARGET_TRIPLE` por plataforma)
- Sysimage mínimo (Symbolics + Unitful + JSON3 + CairoMakie lazy)

**Targets de rendimiento:**
| Métrica | Objetivo |
|---|---|
| Arranque del sidecar (sysimage) | < 3 s |
| Evaluación de fórmula simple | < 50 ms |
| Plot 2D (1000 pts) | < 100 ms (datos) |
| Tamaño total instalador | < 400 MB |

---

## ADR-008: IPC — JSON-RPC 2.0 sobre stdio (NDJSON)

**Estado:** Aceptado
**Contexto:** Comunicación Rust ⇄ Julia.

**Decisión:** NDJSON (un JSON por línea) sobre stdin/stdout del sidecar.
Mensajes con `id`, `method`, `params`, `result`/`error` (JSON-RPC 2.0).
Ventanas: en Windows stdio también funciona con `CREATE_NO_WINDOW`.

**Fallback:** Si se necesitara binario (arrays grandes de plot), usar socket
local (Unix socket / TCP localhost) solo para el canal de datos de gráficos;
el control sigue por stdio. En MVP: todo por stdio con JSON (arrays como
`Float64[]` — suficiente para 10k puntos ≈ 300 KB JSON).

Ver `protocolo-ipc.md` para el esquema completo.

---

## ADR-009: Undo/Redo en el frontend

**Estado:** Aceptado
**Contexto:** El original tiene pila de undo.

**Decisión:** Undo/Redo implementado en React (Zustand + patch inverso del
documento JSON). Cada cambio de celda emite un patch; la pila guarda patches,
no snapshots completos (memoria). Julia no participa (los resultados se
re-evalúan al deshacer).
