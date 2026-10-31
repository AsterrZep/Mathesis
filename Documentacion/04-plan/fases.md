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

## Fase 1 — MVP (hoja de cálculo funcional)

**Objetivo:** documento real con fórmulas, resultados y gráficos 2D.

### Motor Julia
- [ ] Traductor MathJSON completo (~60 operadores: aritmética, trig, log, raíces, potencias)
- [ ] Entorno del documento: variables (`x = 2`), referencias entre celdas, funciones usuario `f(x):=…`
- [ ] Evaluación incremental (re-evaluar solo celdas afectadas)
- [ ] Errores de dominio tipados (DIV_ZERO, UNDEFINED_VAR…)
- [ ] `plot_data`: muestreo de funciones → arrays x/y

### Frontend
- [ ] Worksheet con celdas: `EquationCell`, `ExpressionCell`, `TextCell`
- [ ] Resultados en vivo con debounce
- [ ] Manejo de errores inline
- [ ] `PlotCell` con uPlot (2 funciones, grid, leyenda, zoom/pan)
- [ ] `IntervalCell` (rango de x para el plot)
- [ ] Paleta de símbolos básica (fracción, potencia, √, ∫ Σ, griegas)
- [ ] Undo/Redo (patches)
- [ ] Atajos de teclado (Enter, Delete, mover celdas)

### Rust
- [ ] `doc_new/open/save` (JSON) — diálogo nativo
- [ ] Watchdog del sidecar + reinicio
- [ ] Persistencia de preferencias (tema, dígitos)

**Criterio de salida:** documento con 10 fórmulas encadenadas + gráfico 2D de
`sin(x)`, guardable y reabrible.

## Fase 2 — Unidades, formato y documentos ricos

- [ ] **Unidades** (Unitful): parse de `5 m`, conversión `1 km → 1000 m`, errores de incompatibilidad
- [ ] Unidades de información (bit/byte/kB…) — definiciones custom
- [ ] Celda de **imagen** (embebida base64, como el original)
- [ ] **Importador `.mmt`** (parser XML en Rust → nuestro JSON)
- [ ] Export **LaTeX** del documento (vía engine)
- [ ] Export **PNG/SVG** de figuras (CairoMakie)
- [ ] Export imagen del documento completo (render de celdas → canvas → PNG)
- [ ] Preferencias del documento (dígitos significativos, ancho texto)
- [ ] i18n: ES + EN (i18next)
- [ ] Tema claro/oscuro

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
