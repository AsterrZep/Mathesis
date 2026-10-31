---
name: Mathesis Architecture
description: Load when working on the Mathesis project (super calculator built with Tauri 2 + Rust + React + Julia sidecar) to recall stack decisions, the IPC protocol, where documentation lives, or what to touch for each change.
---

# Mathesis — Arquitectura del proyecto

Mathesis es una calculadora matemática tipo MathCAD (worksheet 2D) para
escritorio, reimplementación evolutiva de microMathematics (GPL-3.0).
Documentación completa en `Documentacion/` (relativo a la raíz del repo).

## Stack congelado (no rediscutir sin motivo)

| Capa | Elección | Detalle |
|---|---|---|
| UI | React 19 + TS + Vite + Zustand | Editor 2D: **MathLive** (`<math-field>`) |
| Gráficos interactivos | **uPlot** (2D) / three.js (3D, fase 3) | Julia manda datos, frontend dibuja |
| Núcleo | Tauri 2 (sidecar via `externalBin` + `tauri-plugin-shell`) | Rust orquesta, NO calcula |
| Motor | Julia 1.12 en proceso **sidecar** | JSON-RPC 2.0 NDJSON sobre **stdio** |
| CAS | Symbolics.jl | Unidades: Unitful.jl · FFT: FFTW.jl · Export: CairoMakie |
| Formato doc | JSON propio con AST en **MathJSON** | Importador `.mmt` (XML) en fase 2 |
| Licencia | POR DECIDIR (ADR-006) | Original es GPL-3.0; si se copia código → GPL obligatoria |

## Reglas de arquitectura (las 8 de oro)

1. Julia es la ÚNICA autoridad matemática — ni React ni Rust calculan.
2. Un solo proceso Julia por la app; watchdog en Rust lo reinicia si crashea.
3. El frontend dibuja gráficos con datos de Julia (zoom/pan local, sin roundtrip).
4. CairoMakie SOLO para exportación (SVG/PNG/PDF), nunca para la vista interactiva.
5. Todo el AST va en MathJSON (estándar MathLive) — ver `Documentacion/01-investigacion/formato-documento-mmt.md`.
6. Errores matemáticos van en `result.status="error"` (no son errores RPC).
7. Eval incremental: grafo de dependencias por `{"ref": id}` entre celdas.
8. Añadir capacidad matemática = añadir módulo Julia + case en traductor;
   NO tocar protocolo, Rust ni formato.

## Dónde mirar cada cosa

| Necesidad | Archivo |
|---|---|
| Qué calcula todo (matriz 56 capacidades) | `Documentacion/06-capacidades/calculo-matematico.md` |
| Métodos del IPC y ejemplos JSON | `Documentacion/02-arquitectura/protocolo-ipc.md` |
| ADRs (por qué sidecar, por qué uPlot+CairoMakie, licencia…) | `Documentacion/02-arquitectura/decisiones-tecnicas.md` |
| Código del original para emular features | `Documentacion/01-investigacion/arquitectura-original.md` |
| Fases y criterios MVP | `Documentacion/04-plan/fases.md` · `mvp-definicion.md` |
| Estructura de carpetas del código | `Documentacion/03-tecnologias/rust-tauri.md` |
| Paquetes Julia y ejemplos | `Documentacion/03-tecnologias/julia.md` |
| MathLive / MathJSON / uPlot | `Documentacion/03-tecnologias/frontend.md` |

## Estructura del repo (destino)

```
Mathesis/
├── src-tauri/    ← Rust (commands/, engine/ RPC client, doc/ model)
├── src/          ← React (components/cells/, state/, mathjson/)
├── engine/       ← Julia (src: rpc.jl, mathjson.jl, env.jl, calc/*)
├── .opencode/skills/  ← estas skills
└── Documentacion/
```

## Estado actual

- **Fase 0 completada** (30-oct-2026): scaffold + `2+2` de punta a punta, CI verde, licencia GPL-3.0.
- **Fase 1 (MVP) COMPLETADA** (31-oct-2026): worksheet multi-celda, variables/funciones
  encadenadas, traductor MathJSON completo, gráficos (PlotCell/IntervalCell + inspector),
  guardar/cargar con diálogo nativo, undo/redo, evaluación incremental (grafo + caché
  en Julia), watchdog del sidecar (tokio::process, backoff, eventos), preferencias
  (tema + dígitos en `doc.settings`), atajos. Tests: 126 Julia + 41 vitest.
- **Binarios precompilados en CI**: engine = paquete Julia compilado con
  PackageCompiler (`tools/build-engine-app.jl` → `src-tauri/engine-runtime`, empaquetado
  como resource; entrypoint `julia_main()` renombrado a `mathesis-engine[.exe]`).
  Workflow `.github/workflows/release.yml`: tag `v*` o manual → Linux/macOS/Windows.
- Seguir `Documentacion/04-plan/fases.md` para el detalle del checklist (siguiente: Fase 2).
