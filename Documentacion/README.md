# 📐 Mathesis — Calculadora matemática multiplataforma (Tauri + Rust + Julia)

> **Repo:** `Mathesis/` — la documentación vive dentro del repo en `Mathesis/Documentacion/`.
>
> Reimplementación multiplataforma de [microMathematics](https://github.com/mkulesh/microMathematics)
> (calculadora científica tipo MathCAD con hoja de cálculo matemática) para escritorio
> (Windows / macOS / Linux), **evolucionada a una super calculadora**: álgebra simbólica,
> límites, derivadas, integrales, vectores/matrices, EDOs, estadística, FFT y unidades.
> Ver la matriz completa en [`06-capacidades/calculo-matematico.md`](06-capacidades/calculo-matematico.md).

## 🎯 Idea central

Una **hoja de cálculo matemática** donde escribes fórmulas en notación 2D legible
(fracciones, integrales, sumatorias) y cada fórmula se evalúa en vivo, con soporte
de unidades, gráficos 2D/3D, y exportación a LaTeX/imagen.

## 🧭 Decisiones clave (ya tomadas)

| Decisión | Elección |
|---|---|
| Alcance | Por fases — **MVP primero** |
| Integración Julia | **Proceso sidecar** vía IPC (JSON-RPC sobre stdio) |
| Frontend | **React + TypeScript** (Vite) |
| Gráficos | Híbrido: **uPlot/WebGL en frontend** para interactivo + **CairoMakie** en Julia para exportación de calidad publicación |
| Formato de documento | **JSON propio** + importador `.mmt` del original |
| Plataformas | Escritorio: Windows, macOS, Linux |
| Licencia | **GNU GPL-3.0** (ADR-006, decidido 30-oct-2026) |

## 📁 Estructura de esta documentación

```
Documentacion/
├── README.md                      ← Estás aquí (índice + resumen ejecutivo)
├── 01-investigacion/              ← Análisis del original microMathematics
│   ├── microMathematics-analisis.md
│   ├── arquitectura-original.md
│   └── formato-documento-mmt.md
├── 02-arquitectura/               ← Diseño del sistema nuevo
│   ├── vision-general.md
│   ├── roles-de-cada-lenguaje.md  ← Qué hace Rust, qué Julia, qué TypeScript
│   ├── protocolo-ipc.md           ← Cómo hablan Tauri ⇄ Julia
│   └── decisiones-tecnicas.md     ← ADRs (incluye análisis CairoMakie vs uPlot)
├── 03-tecnologias/                ← Stack, herramientas, MCPs y skills
│   ├── rust-tauri.md
│   ├── julia.md
│   ├── frontend.md
│   └── mcps-herramientas-skills.md
├── 04-plan/                       ← Roadmap por fases
│   ├── fases.md
│   └── mvp-definicion.md
├── 05-referencias/
│   └── enlaces.md
└── 06-capacidades/                ← ⭐ Matriz maestra de "la super calculadora"
    └── calculo-matematico.md      ← TODO lo que calculará (56 capacidades)
```

## 📊 Flujo de una evaluación (resumen)

```
Usuario escribe fórmula 2D
        │
        ▼
[React + MathLive]  ── convierte a MathJSON/LaTeX ──►
        │
        ▼
[Core Rust (Tauri)] ── JSON-RPC over stdio ────────►
        │                                            │
        │                                            ▼
        │                              [Sidecar Julia - motor matemático]
        │                              • Symbolics.jl (simbólico)
        │                              • Unitful.jl  (unidades)
        │                              • FFTW.jl     (FFT)
        │                              • CairoMakie  (export SVG/PDF/PNG)
        │                                            │
        ◄──── resultado (valor + unidad + errors) ───┘
        │
        ▼
[React] muestra resultado +/uPlot dibuja gráfico
```

## ⚡ Entorno de desarrollo detectado

| Herramienta | Versión | Estado |
|---|---|---|
| Julia | 1.12.6 (juliaup) | ✅ Instalado |
| Rust | 1.97.1 | ✅ Instalado |
| Cargo | 1.97.1 | ✅ Instalado |
| Node.js | 26.2.0 | ✅ Instalado |
| pnpm | — | ✅ Instalado |
| MCPs configurados | — | ⚠️ Ninguno (ver 03-tecnologias/mcps...) |
