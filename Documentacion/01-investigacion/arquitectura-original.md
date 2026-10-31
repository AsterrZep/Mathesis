# Arquitectura original (Java/Android)

> Mapa detallado del código fuente de microMathematics para guiar la
> reimplementación. Cada componente Java tiene un equivalente en nuestro stack.

## Modelo de fórmulas (`formula/`) — el corazón

| Clase Java | Rol | Equivalente nuestro |
|---|---|---|
| `FormulaList` | Lista de fórmulas del documento (el "worksheet") | Estado React (Zustand) + JSON del documento |
| `FormulaBase` | Base de toda fórmula (layout, measure, draw) | Componentes React de cada tipo de celda |
| `Equation` | Ecuación `izq = der` (la más común) | `EquationCell` (React) + evaluación Julia |
| `FormulaResult` | Celda que muestra un resultado guardado | `ResultCell` |
| `FormulaTerm` | Expresión arbitraria con argumentos | `ExpressionCell` |
| `TermField` | Campo editable dentro de una fórmula (hoja de cálculo interna) | `<Mathfield>` de MathLive |
| `TermParser` | Convierte texto → árbol de terms y evalúa | MathJSON → expresión Julia (parse propio) |
| `BracketParser` | Parseo de paréntesis/corchetes | Incluido en el parser Julia |
| `TextFragment` | Texto libre en el documento | `TextCell` (markdown) |
| `StoredFormula` | Fórmula de usuario guardada `f(x):=…` | Entrada del entorno de Julia del sidecar |
| `LinkHolder` | Referencia a resultado de otra fórmula (`content:…link.f`) | Referencia por id en MathJSON |
| `Palette` / `PaletteButton` | Paleta de símbolos para insertar términos | Toolbar React (fórmulas frecuentes) |
| `CalculaterTask` | Tarea asíncrona de evaluación (thread) | Llamada IPC async a Julia |

## Tipos de término (`formula/terms/`)

| Clase | Contenido |
|---|---|
| `TermFactory` | Fábrica: `code` string → instancia de término. **Registro central** |
| `TermTypeIf` | Enum de tipos de term (OPERATOR, FUNCTION, COMPARATOR…) |
| `Operators` | + − × ÷ potencia |
| `Comparators` | = ≠ < > ≤ ≥ |
| `TrigonometricFunctions` | sin cos tan + inversas + hiperbólicas |
| `LogFunctions` | log, ln, exp |
| `NumberFunctions` | factorial, gcd, floor, ceil, redondeo, partes complejas |
| `CommonFunctions` | sqrt, abs, sign, min, max |
| `SeriesIntegrals` | Σ, ∏, ∫ (numérica) |
| `Intervals` | `equidistant_interval` (min/max/step) para variables |
| `ArrayFunctions` | operaciones sobre arrays 1D/2D/3D |
| `UserFunctions` | funciones definidas por el usuario |
| `FileReader` | importar datos de archivos ASCII |
| `FunctionBase` | base para todas las funciones |

## Motor matemático (`math/`)

| Clase | Rol | Equivalente Julia |
|---|---|---|
| `CalculatedValue` | Envoltura valor + unidad (JScience Quantity) | `Unitful.Quantity` |
| `EquationArrayResult` | Resultado array 1D/2D/3D | `Array{T,N}` + metadatos |
| `Fft` | FFT (Apache Commons Math) | `FFTW.jl` |
| `Vector2D` | Utilidad 2D para gráficos | — |
| `AxisTypeConverter` | Escalas lineal/log para ejes | Opciones del renderer |

## Persistencia e intercambio (`io/`)

| Clase | Rol |
|---|---|
| `XmlLoaderTask` | Carga documento XML (`.mmt`) en background |
| `XmlUtils` | Helpers de escritura XML |
| `Exporter` | Base de exportadores |
| `ExportToLatex` | Documento → LaTeX |
| `ExportToMathJax` | Documento → HTML+MathJax |
| `ExportToImage` | Documento → PNG |
| `ImportFromSMathStudio` | `.sm` (SMath) → `.mmt` |

## Gráficos (`plots/`)

- Renderers propios sobre Canvas de Android
- Tipos: `plot_function` (2D), gráficos 3D (superficies, mallas)
- Atributos por función: color, lineStyle (solid/dotted…), width, shapeType
- Ejes: linear/log, grid, estilo "crossed", nº de labels

## Undo (`undo/`)

- Pila de estados del árbol de fórmulas (snapshot serializado)
- Soportado en todo el editor

## Observaciones clave para la reimplementación

1. **El `code` del term** identifica el operador/función (ej. `"power"`, `"asin"`,
   `"mult"`, `"divide"`, `"plus"`, `"minus"`, `"equidistant_interval"`, o
   `"content:com.mkulesh.micromath.link.f"` para referencias). Es un **enum de
   strings** — nuestro MathJSON usa nombres canónicos (`"Power"`, `"Multiply"`…)
   con traducción propia.

2. **`inRightOfPrevious="true"`** — atributo de layout: la celda va a la derecha
   de la anterior (multi-columna). Nuestro JSON debe mantener un campo de layout.

3. **Imágenes embebidas en base64** con `binEncoding`, `imgType` (svg/png),
   `originalSize`, `colorType` — replicable 1:1 en JSON.

4. **`significantDigits`, `textWidth`, `scale`** en la raíz del documento —
   preferencias del documento. Las replicamos en nuestro JSON raíz.

5. **Evaluación por orden del documento** — las fórmulas se evalúan en orden de
   aparición; una fórmula puede referenciar resultados anteriores. El sidecar
   Julia mantiene un **entorno** (dict de variables/funciones) que se
   re-evalúa incrementalmente al cambiar una fórmula.
