# Capacidades matemáticas — la "super calculadora"

> Visión completa de TODO lo que Mathesis calculará, con su hoja de ruta.
> Principio rector: **MVP simple, pero bases preparadas para todo** — el
> protocolo, el AST (MathJSON) y el diseño del engine no cambian al añadir
> capacidades; solo se añaden módulos Julia.

## Mapa de capacidades (matriz maestra)

| # | Dominio | Ejemplo (lo que escribe el usuario) | Motor Julia | Fase |
|---|---|---|---|---|
| **Aritmética y números** | | | |
| 1 | Operaciones básicas | `2 + 3·4 − 5/2` | Base (Symbolics numérico) | **MVP** |
| 2 | Potencias y raíces | `2^10`, `√2`, `∛(x+1)` | Base | **MVP** |
| 3 | Factorial, combinatoria | `5!`, `binomial(10,3)`, `permutaciones` | Base / SpecialFunctions | 2 |
| 4 | Números complejos | `(2+3i)·(1−i)`, `conj(z)`, `Arg(z)` | Complex{Num} nativo | 2–3 |
| 5 | Fracciones exactas | `1/3 + 1/6` → `1/2` (exacto) | `Rational{Int}` | 3 |
| 6 | Precisión arbitraria | `π` a 100 dígitos | `BigFloat` con `setprecision` | 3 |
| **Expresiones y variables** | | | |
| 7 | Variables y constantes | `a = 2.5`, `π`, `e`, `∞` | DocumentEnv | **MVP** |
| 8 | Funciones de usuario | `f(x) = sin(x)/x` · `f(0.5)` | DocumentEnv | **MVP** |
| 9 | Referencias entre celdas | `b = a² + 1` (usa resultado previo) | DocumentEnv + grafo deps | **MVP** |
| **Funciones** | | | |
| 10 | Trigonométricas | `sin(π/6)`, `asin(0.5)` | Base | **MVP** |
| 11 | Hiperbólicas | `sinh(1)`, `atanh(0.5)` | Base | **MVP** |
| 12 | Logaritmos y exp | `ln(e²)`, `log₂(8)`, `exp(1)` | Base | **MVP** |
| 13 | Especiales | `erf(x)`, `gamma(n)`, `BesselJ(n,x)` | SpecialFunctions.jl | 3 |
| **Álgebra** | | | |
| 14 | Evaluación de expresiones | `√(x²+1)` con x conocida | Base | **MVP** |
| 15 | Simplificar | `simplify(sin²α + cos²α)` → `1` | Symbolics.jl | 3 |
| 16 | Expandir / factorizar | `expand((a+b)²)` · `factor(x²−1)` | Symbolics.jl | 3 |
| 17 | Sustituir | `subs(x²+1, x→3)` | Symbolics | 3 |
| 18 | Colectar términos | `collect(polinomio, x)` | Symbolics | 3 |
| 19 | Resolver ecuaciones | `solve(x² − 5x + 6 = 0)` → `{2,3}` | Symbolics (+ Roots fallback) | 3 |
| 20 | Sistemas de ecuaciones | `solve({x+y=3, x−y=1})` | Symbolics (Groebner) | 3–4 |
| 21 | Polinomios | raíces, división, interpolación | Polynomials.jl | 3 |
| **Cálculo** | | | |
| 22 | Derivadas numéricas | `d(f)/dx` numérica (diferencias finitas) | Propio | 2 |
| 23 | Derivadas simbólicas | `diff(x³·sin(x), x)` → `3x²sin(x)+x³cos(x)` | Symbolics.diff | 3 |
| 24 | Derivadas parciales / orden n | `diff(f, x, y)` | Symbolics | 3 |
| 25 | Integrales numéricas 1D | `∫₀¹ √(1−x²) dx` → numérico + error | QuadGK.jl | 2 |
| 26 | Integrales dobles | `∫∫_D f(x,y) dA` | QuadGK anidada | 3 |
| 27 | Integrales simbólicas | `∫ x·eˣ dx` → `(x−1)eˣ + C` | Rubi.jl / Symbolics (ver escape hatch) | 4 |
| 28 | Límites numéricos | `lim x→0 sin(x)/x` → 1 (por aproximación) | Propio (dos lados + ε) | 2 |
| 29 | Límites simbólicos | `lim x→∞ (1+1/x)ˣ` → e | SymbolicLimits / escape hatch | 4 |
| 30 | Series Σ y productos ∏ | `Σ_{k=1}^{100} 1/k²` | Base + loop | 2 |
| 31 | Series de potencias / Taylor | `series(exp(x), x, 0, 5)` | Symbolics (fase tardía) | 4 |
| **Vectores y matrices** | | | |
| 32 | Vectores 2D/3D | `v = [1,2,3]`, `‖v‖`, `v·w` (punto), `v×w` (cruz) | LinearAlgebra | 3 |
| 33 | Ángulo y proyección entre vectores | `angle(v,w)`, `proj(v,w)` | LinearAlgebra + propios | 3 |
| 34 | Matrices: operaciones | `A+B`, `A·B`, `Aᵀ`, `A⁻¹`, `det(A)`, `rango(A)` | LinearAlgebra (stdlib) | 3 |
| 35 | Autovalores / autovectores | `eigen(A)` | LinearAlgebra | 3 |
| 36 | Sistemas lineales | `solve(A·x = b)` | LinearAlgebra (`\`) | 3 |
| 37 | Matrices simbólicas | operaciones con entradas simbólicas | Symbolics + LinearAlgebra | 4 |
| **Ecuaciones diferenciales** | | | |
| 38 | EDOs numéricas | `y' = −2xy, y(0)=1` → solución numérica + gráfica | OrdinaryDiffEq.jl | 4 |
| 39 | Sistemas de EDOs / campos de direcciones | `x' = f(x,y)` + plot del campo | OrdinaryDiffEq + three.js | 4 |
| **Estadística** | | | |
| 40 | Estadística descriptiva | `mean(datos)`, mediana, desviación, varianza, percentiles | Statistics.jl (stdlib) | 3 |
| 41 | Datos desde array/archivo | array en el worksheet o CSV | DataFrames/CSV | 2–3 |
| 42 | Distribuciones | `Normal(μ,σ)`, probabilidades, cuantiles | Distributions.jl | 4 |
| 43 | Regresión / ajuste | ajuste lineal de datos | Polynomials/LsqFit | 4 |
| **Señales** | | | |
| 44 | FFT | FFT de una señal (como `cosine_transform.mmt` del original) | FFTW.jl | 3 |
| 45 | Ventanas y espectro | ventanas Hamming/Hann, FFT real | FFTW + propios | 3 |
| **Unidades (paridad con el original)** | | | |
| 46 | Unidades SI y conversión | `5 m + 250 cm` → `7.5 m` · `3 kg·m/s²` | Unitful.jl | 2 |
| 47 | Análisis dimensional | error si `1 m + 2 s`; simplificación automática de unidades | Unitful | 2 |
| 48 | Unidades de información | `1 kB` en bits, etc. | Definiciones custom (como el original) | 2 |
| **Gráficos** | | | |
| 49 | Gráficos 2D interactivos | plot de funciones, zoom/pan | Julia datos + uPlot | **MVP** |
| 50 | Escalas log y múltiples curvas | ejes log-log, leyendas | uPlot | 2–3 |
| 51 | Curvas polares y paramétricas | `r(θ)`, `x(t),y(t)` | Julia muestrea + uPlot | 2–3 |
| 52 | Gráficos 3D (superficies) | `z = sin(√(x²+y²))` | Julia malla + three.js | 3 |
| 53 | Export de figuras calidad publicación | SVG/PNG/PDF del gráfico | CairoMakie | 2 |
| **Salida** | | | |
| 54 | Resultado en LaTeX | cada resultado es exportable | MathJSON→LaTeX / Latexify | 2–3 |
| 55 | Documento → LaTeX completo | export del worksheet entero | ExportToLatex (como el original) | 2 |
| 56 | Documento → imagen | PNG del documento | Render frontend | 2 |

## Bases preparadas: por qué TODO lo anterior encaja sin rediseños

### 1. El AST (MathJSON) ya contempla todo

La librería estándar MathJSON ya tiene nodos para `Derivative`, `Integrate`,
`Limit`, `Sum`, `Product`, `Matrix`, `Determinant`, `Eigenvalues`… Es decir:
**el formato del documento nunca limita lo que se puede expresar**. Cuando en la
fase 3 añadimos `diff`, el usuario ya puede escribir la notación de derivada en
el editor; el engine simplemente empieza a entenderla.

### 2. El protocolo IPC es agnóstico al cálculo

Añadir una capacidad matemática **no toca** el protocolo (`eval_cell`,
`plot_data`, `export` siguen igual), **no toca** Rust, **no toca** la UI (salvo
añadir botones de paleta). Solo se añade Julia:

```
engine/src/
├── calc/                ← carpetita que crece con las fases
│   ├── algebra.jl       (fase 3: simplify/expand/factor/solve)
│   ├── calculus.jl      (fase 2-3: derivadas numéricas, integrales)
│   ├── limits.jl        (fase 2: numérico; fase 4: simbólico)
│   ├── linalg.jl        (fase 3: vectores y matrices)
│   ├── stats.jl         (fase 3)
│   ├── fft.jl           (fase 3)
│   └── ode.jl           (fase 4)
```

Cada módulo se registra en el **traductor MathJSON** (`mathjson.jl`): añadir
una función = añadir un case al dispatch. Catálogo abierto.

### 3. Symbolics.jl como núcleo simbólico es un "upgrade gratis"

Symbolics es el motor detrás de **ModelingToolkit** (el suite de modelado del
mismo ecosistema SciML). Cada versión de Symbolics mejora simplify/diff/solve
sin que nosotros hagamos nada. Y si mañana queremos control simbólico
avanzado, el camino ya está trazado.

### 4. Estrategia de "escape hatches" (último recurso)

Algunos cálculos simbólicos son duros incluso para los mejores CAS
(integrales simbólicas generales, límites de formas exóticas). Plan documentado:

| Capacidad dura | Plan A (primero) | Plan B (fallback) | Plan C (último recurso) |
|---|---|---|---|
| Integrales simbólicas | **Rubi.jl** (port de Rubi — reglas de integración, proyecto activo) | Integral numérica (QuadGK) con aviso | PythonCall.jl + SymPy (backend opcional, off por defecto) |
| Límites simbólicos | Aproximación numérica por dos lados (sorprendentemente efectiva) | SymbolicLimits.jl (experimental) | SymPy |
| solve simbólico completo | Symbolics solve + Roots.jl (numérico robusto) | — | SymPy |

**Nunca** exponer al usuario un "no puedo": si el método simbólico falla, se
cae a numérico con un indicador en el resultado (`≈` vs `=`).

### 5. Precisión y tipos promovibles

Todo el pipeline está parametrizado por el tipo numérico:
- `Float64` por defecto (rápido)
- `BigFloat` cuando el usuario pide más precisión (preferencia por documento —
  el original tiene `significantDigits`)
- `Rational` para aritmética exacta (opción "exacto" en fase 3)
- `Complex` transparente (la aritmética compleja es nativa)

### 6. Escalabilidad de rendimiento

- Evaluación incremental con grafo de dependencias (ya en el diseño del MVP)
- Cálculos largos: notificaciones `progress` del engine + `cancel` del usuario
  (ya definidos en el protocolo IPC)
- Arrays grandes de plot: si JSON se queda corto (>100k puntos), el ADR-008
  prevé el canal binario por socket local

## Paridad con microMathematics (checklist)

| Feature del original | Mathesis | Fase |
|---|---|---|
| Editor 2D + evaluación en vivo | ✅ MathLive + engine | MVP |
| Variables + funciones de usuario | ✅ DocumentEnv | MVP |
| Gráficos 2D | ✅ uPlot | MVP |
| Unidades SI/no-SI | ✅ Unitful | 2 |
| Unidades de información | ✅ definiciones custom | 2 |
| Arrays 1D/2D/3D | ✅ | 3 |
| Gráficos 3D | ✅ three.js | 3 |
| FFT | ✅ FFTW | 3 |
| Series / integrales numéricas | ✅ QuadGK | 2–3 |
| Texto + imágenes en documento | ✅ | 2 |
| Export LaTeX / imagen | ✅ | 2 |
| Import ASCII (FileReader) | ✅ CSV/DataFrames | 2–3 |
| Import/export SMath Studio | ⚠️ evaluar viabilidad | 4 |
| **Extras que el original NO tiene** | | |
| Álgebra simbólica (simplify/factor/solve) | 🚀 Symbolics | 3 |
| Derivadas simbólicas | 🚀 | 3 |
| Vectores y matrices (álgebra lineal) | 🚀 LinearAlgebra | 3 |
| Precisión arbitraria BigFloat | 🚀 | 3 |
| Estadística descriptiva | 🚀 | 3 |
| Ecuaciones diferenciales | 🚀 OrdinaryDiffEq | 4 |
| Export SVG/PDF de figuras | 🚀 CairoMakie | 2 |
| Servidor MCP (motor como herramienta IA) | 🚀 ModelContextProtocol.jl | 4 |

**Conclusión**: Mathesis no es solo un clone — supera al original en álgebra
simbólica, cálculo vectorial y EDOs, manteniendo toda su funcionalidad.

## Orden de implementación recomendado (resumen)

```
MVP   → 2 (básico) + variables + funciones + trig/log + plot 2D
Fase 2 → unidades + integrales numéricas + límites numéricos + Σ + export
Fase 3 → álgebra simbólica + derivadas + solve + vectores/matrices +
          estadística + FFT + complejos + precisión
Fase 4 → integrales/límites simbólicos + EDOs + distribuciones +
          matrices simbólicas + MCP server
```

Cada fase entrega valor usable; ninguna depende de rediseños.
