# Definición del MVP (Fase 1)

## ¿Qué ES el MVP?

Una app de escritorio (Win/macOS/Linux) donde puedes:

1. **Escribir fórmulas** en notación matemática 2D (como MathCAD):
   - `f(x) = √(x² + 1)`
   - fracciones `a/b` apiladas, potencias `x^n`, símbolos griegos
2. **Ver resultados en vivo** mientras editas (con debounce)
3. **Encadenar fórmulas**: `a = 2`, luego `b = a² + 1` usa `a`
4. **Definir funciones**: `f(x) = sin(x)/x` y usarlas después
5. **Texto libre** entre fórmulas (documentación)
6. **Graficar** funciones 2D de un rango dado (zoom/pan con uPlot)
7. **Guardar/cargar** el documento (JSON) y reabrirlo tal cual

## ¿Qué NO incluye el MVP?

- ❌ Unidades (fase 2)
- ❌ Imágenes (fase 2)
- ❌ Importador `.mmt` (fase 2)
- ❌ LaTeX/PNG export (fase 2)
- ❌ Álgebra simbólica (simplify/diff) (fase 3)
- ❌ FFT, arrays, 3D (fase 3)
- ❌ Instaladores bonitos (se puede distribuir como carpeta)

## User stories del MVP

| # | Historia | Criterio de aceptación |
|---|---|---|
| US-1 | Como usuario, escribo `2+2` y veo `4` | Resultado aparece < 500 ms tras dejar de escribir |
| US-2 | Como usuario, defino `x = 5` y uso `x*2` → `10` | Propagación de resultados |
| US-3 | Como usuario, defino `f(x) = x²` y evalúo `f(3)` → `9` | Funciones de usuario |
| US-4 | Como usuario, inserto una fracción 2D con la paleta | Editor 2D real (no texto plano) |
| US-5 | Como usuario, creo un gráfico de `sin(x)` en [-π, π] | Gráfico interactivo (zoom/pan) |
| US-6 | Como usuario, guardo y reabro el documento | JSON roundtrip perfecto |
| US-7 | Como usuario, escribo una fórmula inválida (`1/0`) | Error inline, la app no se rompe |
| US-8 | Como usuario, hago undo/redo | Pila de 50+ pasos |
| US-9 | Como usuario, muevo/borro celdas | Layout reordenable |

## Stack congelado del MVP

| Capa | Elección |
|---|---|
| Frontend | React 19 + TS + Vite + Zustand + MathLive + uPlot |
| Núcleo | Tauri 2 + tauri-plugin-shell + serde |
| Engine | Julia 1.12 + Symbolics + JSON3 (sin Unitful todavía, sin CairoMakie todavía) |
| IPC | JSON-RPC NDJSON sobre stdio |

## Definición de "hecho" del MVP

- [ ] Los 9 criterios de arriba pasan (tests E2E con Playwright + mock, y smoke test manual con engine real)
- [ ] `cargo clippy -D warnings` limpio
- [ ] `tsc --noEmit` limpio
- [ ] Tests del engine Julia pasan (`Pkg.test`)
- [ ] Doc de 20 celdas de ejemplo (como los `.mmt` del original) evaluando < 2 s
- [ ] Funciona en Linux (tu plataforma de dev); Windows/macOS "debería funcionar" (probar en CI)

## Riesgo principal del MVP

**MathLive como editor de fórmulas estructuradas.** Si MathLive no permite
confortablemente insertar estructuras con placeholders (∫ con huecos de
límite/superior/integrando), hay que decidir en la semana 1:

- Plan A: MathLive en modo "latex input" (el usuario tipea `\int_0^1`)
- Plan B: componente custom de inserción de estructuras sobre MathLive
- Plan C: otro editor (KaTeX es solo render, no editor — no sirve)

Investigar esto es el **primer task** de la Fase 0/1.
