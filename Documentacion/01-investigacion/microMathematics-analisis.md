# Análisis de microMathematics

**Repo:** https://github.com/mkulesh/microMathematics
**Autor:** Mikhail Kulesh · **Licencia:** GPL-3.0 · **Stars:** ~683 · **Commits:** 766
**Plataforma original:** Android (Java) · Disponible en Google Play y F-Droid

## ¿Qué es?

**microMathematics Plus** es una calculadora científica gráfica orientada a una
**hoja de cálculo (worksheet)**. Concepto similar a MathCAD: no es una calculadora
de una línea, sino un **documento** donde colocas fórmulas en notación matemática
2D legible (fracciones apiladas, integrales con límites, sumatorias), y cada
fórmula se evalúa automáticamente en vivo. Los resultados de una fórmula pueden
usarse en fórmulas posteriores (propagación de resultados).

## Features principales (del README oficial)

1. **Editor matemático 2D táctil** con undo — escritura en forma "natural"
2. **Evaluación en vivo** de identidades matemáticas con alta precisión
3. **Unidades SI y no-SI** — incluye unidades de información (bit, byte…) con
   conversión automática entre unidades compatibles
4. **Arrays 1D/2D/3D** para almacenar resultados intermedios (mejora rendimiento)
5. **Documento compuesto**: fórmulas + gráficos + **texto libre** + **imágenes**
   (incluye SVG embebido en base64)
6. **Gráficos 2D y 3D** de funciones (con escalas lineales/logarítmicas, ejes
   "crossed", estilos de línea, shapes…)
7. **FFT** (transformada coseno/rápida), series, integrales numéricas, dobles
   integrales
8. **Exportación**: LaTeX, MathJax, imagen (PNG/SVG)
9. **Importación**: archivos ASCII, documentos **SMath Studio** (bidireccional)
10. **Funciones de usuario** — defines `f(x)` en el documento y la usas en el resto
11. **Privacidad total**: sin ads, trackers, telemetría ni permisos especiales
12. **6 idiomas**: EN, RU, DE, PT-BR, ZH, ES

## Elementos del lenguaje del worksheet (tipos de "term")

El editor soporta estos tipos de elementos (vistos en `formula/terms/`):

| Categoría | Ejemplos |
|---|---|
| Operadores | `+ − × ÷ ^` (potencia) |
| Comparadores | `= ≠ < > ≤ ≥` |
| Trigonométricas | sin, cos, tan, asin, acos, atan, seno hiperbólico… |
| Log/Exp | log₁₀, ln, exp |
| Números | factorial, gcd, módulo, redondeo, partes de un número complejo |
| Funciones comunes | sqrt, abs, sign, min, max, ceil, floor |
| Series/Integrales | Σ sumatoria, ∏ producto, ∫ integral (numérica) |
| Intervalos | `equidistant_interval` (rango para variables x, y) |
| Arrays | funciones de arrays 1D/2D/3D |
| Funciones usuario | `f(x)`, `g(x,y)` definidas en el propio documento |
| Lectura de archivos | importar datos ASCII |

## Stack tecnológico original

- **Java / Android SDK** (Android Support v7)
- **Apache Commons Mathematics** — algoritmos numéricos (FFT, integración…)
- **JScience** — magnitudes y unidades
- **AndroidSVG** — render/soporte SVG
- Documento guardado en **XML** con namespace `http://micromath.mkulesh.com`

## Paquetes de código fuente

```
com.mkulesh.micromath
├── MainActivity / BaseFragment / MainFragmentWorksheet  ← UI Android
├── dialogs/       ← diálogos (guardar, propiedades, settings)
├── fman/          ← gestor de archivos integrado
├── formula/       ← ⭐ MODELO DE FÓRMULAS (Equation, FormulaList, TermParser…)
│   └── terms/     ← ⭐ TIPOS DE TÉRMINOS (TermFactory + operadores/funciones)
├── io/            ← ⭐ XML load/save + exportadores (LaTeX, MathJax, imagen)
│                    + ImportFromSMathStudio
├── math/          ← CalculatedValue (valor+unidad), Fft, EquationArrayResult
├── plots/         ← gráficos 2D/3D (View+renderer propios)
├── plus/          ← variante "Plus" de la app
├── properties/    ← preferencias
├── ta/            ← text analysis?
├── undo/          ← pila de undo
├── utils/         ← utilidades
└── widgets/       ← widgets custom (term editor)
```

## Lecciones aprendidas para el clone

1. **Todo es un árbol de "terms"** — el documento es una lista de fórmulas, cada
   fórmula es un árbol de nodos (`term` con `key`, `text`, `code`). Este AST es
   la clave del formato de archivo, la evaluación Y el renderizado 2D.
2. **Separación modelo/vista** — el mismo AST alimenta al parser matemático y al
   layout del editor 2D. Debemos replicar esto (nuestro AST = MathJSON).
3. **`CalculatedValue` envuelve valor + unidad** — las unidades viajan con el
   número en todo el cálculo. Unitful.jl nos da esto nativamente en Julia.
4. **`content:com.mkulesh.micromath.link.f`** — referencias a funciones de
   usuario por enlace (link). En nuestro JSON: referencias por id/uid.
5. **Compatibilidad SMath** — el `.sm` de SMath Studio es binario/otro formato;
   solo lo importamos (fase tardía).
6. **GPL-3.0** — si copiamos código del original, nuestro producto debe ser
   GPL-3.0. Si reimplementamos desde cero (nuestro caso), la licencia es libre
   (decisión pendiente, ADR-006).
