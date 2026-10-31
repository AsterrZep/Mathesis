# Plan de desarrollo por fases

> Estrategia: **MVP primero** (decisión del usuario), luego expansión por fases.
> Cada fase deja una app utilizable.

## Fase 0 — Cimientos (semilla) ✅ COMPLETADA (30-oct-2026)

**Objetivo:** esqueleto que ejecuta "2+2" de punta a punta.

- [x] Scaffold del monorepo con las 3 carpetas: `src-tauri/`, `src/`, `engine/`
- [x] `pnpm create tauri-app` + React + TS + Vite
- [x] Engine Julia mínimo: loop RPC NDJSON con `hello`, `ping`, `eval_cell` (aritmética + Delimiter/InvisibleOperator/Tuple)
- [x] Comando Tauri `eval_cell` (puente frontend→Rust→Julia con correlación por id)
- [x] UI mínima: `<math-field>` (MathLive) + resultado en vivo con debounce
- [x] Mock engine en TS espejo del engine Julia (16 tests vitest)
- [x] CI básica (frontend + Rust clippy + Julia tests) — **verde en GitHub Actions**

**Criterio de salida:** escribir `2+2` en el editor muestra `4` (vía Julia real) ✅
(verificado: `22(8) = 176` end-to-end en app real, run `41159916123` CI verde)

**Extra cerrado en Fase 0:**
- M-1 sombreado blanco (causa raíz: `--contains-highlight-background-color`)
- M-2 parse `canonical:false` (fix bug "Variable no definida: NaN")
- Repo público `AsterrZep/Mathesis` + licencia **GPL-3.0** (ADR-006) +3 commits
- Diseño UI vía MCP Stitch (`Documentacion/07-diseno/`)
- Tests: **16 vitest + 35 Julia**

## Fase 1 — MVP ✅ COMPLETADA (31-oct-2026)

> **Progreso (31-oct-2026):** ✅ worksheet multi-celda con gutter numerado ·
> ✅ variables encadenadas (`eval_document` + EvalCtx) · ✅ funciones de usuario
> `f(x):=…` + llamadas · ✅ paleta de símbolos (insert en celda activa) ·
> ✅ gráficos uPlot en inspector + **PlotCell/IntervalCell en la hoja** ·
> ✅ traductor MathJSON completo · ✅ guardar/cargar JSON (diálogo nativo) ·
> ✅ atajos (Enter · Ctrl+S/O/N/Z/Y) · ✅ **undo/redo** (historial con
> coalescencia de tecleo, snapshots por structural sharing) ·
> ✅ **evaluación incremental** (grafo de dependencias + caché por celda en
> Julia; `changedCellIds` re-evalúa solo afectados) · ✅ **watchdog** del
> sidecar (ping 30s, reinicio backoff 1-2-4s ×3, eventos engine-status,
> shutdown limpio, spawn vía tokio::process con resolución dev/release) ·
> ✅ **preferencias del documento** (tema claro/oscuro + dígitos significativos,
> persistidas en `doc.settings`) · ✅ **binarios precompilados en CI**
> (PackageCompiler app relocatable empaquetada como resource; workflow
> binarios precompilados (PackageCompiler; workflow Release solo Linux))
>
> Tests: **126 Julia + 41 vitest** · clippy limpio · commits `8a4a511` +
> `868a83c` + chunk 3

**Objetivo:** documento real con fórmulas, resultados y gráficos 2D.

### Motor Julia
- [x] Traductor MathJSON completo (~60 operadores: aritmética, trig, log, raíces, potencias)
- [x] Entorno del documento: variables (`x = 2`), referencias entre celdas, funciones usuario `f(x):=…`
- [x] Evaluación incremental (re-evaluar solo celdas afectadas — grafo + caché DOC_CACHE)
- [x] Errores de dominio tipados (DIV_ZERO, UNDEFINED_VAR, DOMAIN, NAN, INFINITY, LATEX_INCOMPLETE…)
- [x] `plot_data`: muestreo de funciones → arrays x/y (gaps `null` fuera de dominio)

### Frontend
- [x] Worksheet con celdas: `math` / `text` (ramas de `CellRow`)
- [x] Resultados en vivo con debounce
- [x] Manejo de errores inline
- [x] `PlotCell` con uPlot (2 funciones, grid, leyenda, zoom/pan) — celda en la hoja
- [x] `IntervalCell` (rango de x para el plot: desde/hasta/pasos)
- [x] Paleta de símbolos básica (fracción, potencia, √, ∫ Σ, griegas)
- [x] Undo/Redo (historial con coalescencia de tecleo; Ctrl+Z / Ctrl+Shift+Z)
- [x] Atajos de teclado (Enter, Ctrl+S, Ctrl+O, Ctrl+N, Ctrl+Z/Y)

### Rust
- [x] `doc_open`/`doc_save` (JSON) — diálogo nativo (`tauri-plugin-dialog`); `doc_new` en el frontend
- [x] Watchdog del sidecar + reinicio (ping 30 s, backoff 1s/2s/4s ×3, eventos, shutdown limpio)
- [x] Persistencia de preferencias (tema claro/oscuro + dígitos significativos en `doc.settings`)

### CI / distribución (extra acordado)
- [x] Engine empaquetable: `PackageCompiler.create_app` → `src-tauri/engine-runtime`
      (relocatable, sin Julia instalada) + workload de precompilación
- [x] Workflow **Release** (`.github/workflows/release.yml`): tag `v*` o manual →
      Linux (AppImage/deb/rpm), con cache del sysimage y draft release con los instaladores
- [x] **🚀 Primera release publicada: `v0.1.0`** (31-oct-2026, solo Linux por decisión
      del usuario) → https://github.com/AsterrZep/Mathesis/releases/tag/v0.1.0
      · Assets: `.deb` (Debian/Ubuntu) + `.rpm` · 390 MB (runtime PackageCompiler completo —
      optimizar en Fase 4) · AppImage pendiente: `linuxdeploy` falla en el runner
      (fallback a deb/rpm activo; debug con `--verbose`)
- [x] **🚀 Release `v0.1.1` publicada** (31-oct-2026) →
      https://github.com/AsterrZep/Mathesis/releases/tag/v0.1.1
      · `.deb`/`.rpm` 226 MB (−42 % con strip) · fixes de la laptop (M-3 pantalla negra,
      M-4 sonidos, `julia_main` Cint) · **incluye unidades Unitful + export LaTeX** ·
      versiones sincronizadas · engine cacheado en CI para próximos tags

**Criterio de salida:** documento con 10 fórmulas encadenadas + gráfico 2D de
`sin(x)`, guardable y reabrible. ✅ **cumplido** (31-oct-2026): celda plot con
`sin(x)+cos(x)` sobre `[-2π,2π]`, guardado/carga con diálogo nativo, undo/redo,
evaluación incremental, watchdog y preferencias. CI: tests + **release `v0.1.0`
publicada** (solo Linux: `.deb` + `.rpm`, PackageCompiler).

## Fase 2 — Unidades, formato y documentos ricos

> **Progreso (31-oct-2026):** ✅ **Unidades con Unitful** (núcleo) ·
> ✅ **Unidades de información** custom · ✅ **Export LaTeX** (botón Export) ·
> ⬜ imagen · ⬜ importador `.mmt` · ⬜ exports PNG/SVG · ⬜ ancho de texto ·
> ⬜ i18n · ✅ tema claro/oscuro (hecho en Fase 1)
>
> Tests: **173 Julia + 41 vitest**

- [x] **Unidades** (Unitful): parse de `5 m` (hoja `"m"` → cantidad), conversión
      `1 km → 1000 m` (`["To",…]`), errores de incompatibilidad (`UNIT_MISMATCH`),
      °C affine (`UNIT_AFFINE` — se interpreta el literal `100 °C` y `→` convierte),
      trigonométricas convierten ángulos a radianes, floor/round EN SU UNIDAD,
      definitions/plot env round-trip vía parser `"m s^-1"`, paleta con pestaña Units
- [x] Unidades de información (bit/byte/kB/MB) — definiciones custom con dimensión
      propia (`@dimension` + `@refunit` + `@unit`; UnitfulBits no está en el registry)
- [ ] Celda de **imagen** (embebida base64, como el original)
- [ ] **Importador `.mmt`** (parser XML en Rust → nuestro JSON)
- [x] Export **LaTeX** del documento (vía engine — `export` kind=latex + comando
      `doc_export` con diálogo nativo, resultados de Julia en cada fórmula,
      texto escapado; botón Export del topbar activo)
- [ ] Export **PNG/SVG** de figuras (CairoMakie)
- [ ] Export imagen del documento completo (render de celdas → canvas → PNG)
- [ ] Preferencias del documento (dígitos ✅ en Fase 1 · ancho texto pendiente)
- [ ] i18n: ES + EN (i18next)
- [x] Tema claro/oscuro (Fase 1: `settings.theme` + `data-theme`)

## Fase 3 — Potencia matemática

- [ ] **Álgebra simbólica** (Symbolics): botón "simplificar", "expandir", "derivar" en selección
- [ ] **FFT** (FFTW) + celda de transformada (como `cosine_transform.mmt`)
- [ ] **Arrays 1D/2D/3D** (como el original): rangos equidistantes, funciones de array
- [ ] **Gráficos 3D** (superficies): three.js + datos de Julia
- [ ] Integrales numéricas simbólico-numéricas (QuadGK)
- [ ] Series (Σ, ∏) evaluadas numéricamente
- [ ] Escalas logarítmicas en plots
- [ ] Modo "solo resultado" (ResultCell enlazable)

## Fase 4 — Madurez y distribución

- [ ] **PackageCompiler**: sysimage + app relocatable → instaladores
- [ ] Instaladores por plataforma (NSIS/MSI, DMG, AppImage/deb/rpm)
- [ ] Auto-update (tauri-plugin-updater)
- [ ] Import SMath Studio (`.sm`) — evaluar viabilidad
- [ ] System tray, múltiples ventanas/documentos
- [ ] Modo "lite" (Julia del sistema vía juliaup si existe)
- [ ] **Servidor MCP** del engine (exponer simplify/solve/plot como herramientas IA)
- [ ] Plugin de export a Jupyter/Pluto notebook
- [ ] Benchmarking + optimización de arranque
- [ ] Documentación de usuario + tutoriales (como el "How to use" del original)

## Mejoras registradas (feedback de uso)

| # | Mejora | Origen | Estado |
|---|---|---|---|
| M-1 | **Sombreado blanco al editar dentro de paréntesis**. Diagnóstico con overlay en el shadow DOM: el culpable NO era `--selection-color` (el default `hsl(…,70%,85%)` de `.ML__selection`) sino **`.ML__focused .ML__contains-highlight`** con `--contains-highlight-background-color: hsl(var(--_hue),40%,95%)` (≈ rgb(237,242,247)) — resalta el grupo bajo el cursor. Fix: variable sobrescrita (inline JS en `MathField.tsx` + `App.css` + hoja en el shadow DOM de MathLive con `::selection` cubierto) → `rgba(110,168,254,0.30)`. Verificado con captura: sin blancos. | Feedback usuario Fase 0 | ✅ Aplicada y verificada |
| M-2 | **Parse con `canonical:false`**: el MathJSON default de compute-engine *evaluaba* constantes (`1/0` → string `"NaN"`, `1/3` → `["Rational",…]`), causando errores falsos ("Variable no definida: NaN") y ops desconocidas. Ahora el frontend parsea el LaTeX con `ce.parse(latex, {canonical:false})` y Julia recibe el AST puro; el engine añadió `Delimiter`, `InvisibleOperator`, `Tuple` y errores NAN/INFINITY. | Bug encontrado en pruebas Fase 0 | ✅ Aplicada (tests: 16 vitest + 35 Julia) |
| M-3 | **Ventana negra en laptops con GPU antigua** (release v0.1.0): WebKitGTK con compositing no pinta en algunos drivers — workaround manual `WEBKIT_DISABLE_COMPOSITING_MODE=1`. Fix: la app exporta la variable por defecto en `run()` (solo si el usuario no la ha puesto), documentado en `protocolo-ipc.md`. | Feedback usuario release v0.1.0 (laptop de pocos recursos) | ✅ Aplicada en `src-tauri/src/lib.rs` |
| M-4 | **Spam de GStreamer en consola** (`audio-file-reader-N: Missing decoder: text/html` por cada tecla): MathLive usa `_soundsDirectory = "./sounds"` y los `.wav` (keypress/plonk) no viajan en el bundle Tauri → el protocolo devuelve HTML y WebKit intenta decodificarlo como audio. Fix: `MathfieldElement.keypressSound = null` + `plonkSound = null` en `MathField.tsx` (si se quiere sonido en el futuro: empaquetar los .wav como assets). | Feedback usuario release v0.1.0 | ✅ Aplicada |
| M-5 | **`.deb` de 1.17 GB instalados / ~390 MB comprimido** (runtime PackageCompiler con debug info de libLLVM/libjulia-codegen). Mitigación inmediata: `strip --strip-unneeded` de todos los ELF tras `create_app` (`tools/build-engine-app.jl`). Optimizaciones mayores (Fase 4): `filter_stdlibs`, modo "lite" con Julia del sistema, PackageCompiler mínimo. | Feedback usuario release v0.1.0 | 🔶 Strip aplicado; Fase 4 pendiente |

## Riesgos identificados

| Riesgo | Impacto | Mitigación |
|---|---|---|
| MathLive no cubre algún elemento 2D (∫ con límites…) | Alto | Investigar API de MathLive en fase 0; fallback: LaTeX crudo + render custom |
| Sysimage Julia muy grande (>500 MB) | Medio | Lazy-load CairoMakie; sysimage mínimo; medir en fase 4 |
| Arranque del sidecar lento sin sysimage (dev) | Bajo | Aceptable en dev; lazy-start (arrancar al primer cálculo) |
| Windows + stdio con sidecar | Medio | Probar pronto en Windows; fallback socket local (ADR-008) |
| Rendimiento de evaluación incremental | Medio | Grafo de dependencias en Julia; medir con doc de 500 celdas |
| ~~Licencia~~ | ~~Bloqueante release~~ | ✅ Resuelta: **GPL-3.0** (ADR-006, 30-oct-2026) |

## Hito de validación temprana (semana 1-2)

Antes de invertir en las fases completas, validar la **hipótesis técnica**:

1. MathLive renderiza y edita una ecuación con fracción + integral 2D en React ✅/❌
2. Julia sidecar responde `eval_cell` en < 50 ms con sysimage mínimo ✅/❌
3. uPlot dibuja `sin(x)` con datos de Julia en la webview de Tauri ✅/❌

Si alguno falla, re-evaluar alternativas ANTES de seguir.
