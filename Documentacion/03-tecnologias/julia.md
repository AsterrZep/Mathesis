# Stack: Julia (motor matemático)

> Julia 1.12.6 instalada vía juliaup ✅

## Paquetes principales

| Paquete | Rol | Equivalente en el original |
|---|---|---|
| **Symbolics.jl** | Álgebra simbólica: `simplify`, `expand`, `diff`, `substitute`, aritmética simbólica | Apache Commons Math (parcial) + lógica propia |
| **Unitful.jl** | Unidades y dimensionalidad: conversión automática, SI + no-SI | JScience |
| **FFTW.jl** | FFT rápida | Apache Commons Math Fft |
| **QuadGK.jl** | Integrales numéricas (1D) | Commons Math integrators |
| **SpecialFunctions.jl** | erf, gamma, bessel… | — (mejora sobre el original) |
| **CairoMakie.jl** | Render de figuras → SVG/PNG/PDF (export) | AndroidSVG/Canvas |
| **JSON3.jl** | Parse/serialize JSON rápido (IPC + MathJSON) | — |
| **PackageCompiler.jl** | Sysimage + app relocatable (dev-time de build) | — |
| **PrecompileTools.jl** | Precompilar rutas hot del engine | — |
| **Revise.jl** | Hot-reload en desarrollo del engine | — |
| **LinearAlgebra**, **Statistics** | Estándar | — |

### Paquetes para fases tardías

| Paquete | Para qué | Fase |
|---|---|---|
| OrdinaryDiffEq.jl | Ecuaciones diferenciales | 3 |
| DifferentialEquations.jl | Suite completa ODE/PDE/SDE | 4 (evaluar) |
| Polynomials.jl | Raíces de polinomios, interpolación | 3 |
| Distributions.jl | Estadística | 3 |
| DataFrames + CSV | Importación de datos ASCII (FileReader) | 2 |
| Latexify.jl | AST → LaTeX (fallback/export) | 2 |

**Nota sobre Latexify**: útil, pero como MathLive ya genera LaTeX para display,
Latexify se usa principalmente para el **export LaTeX del documento**. Se puede
empezar sin él (generar LaTeX manualmente desde MathJSON) y añadirlo si
compensa.

## Proyecto Julia (`engine/Project.toml`)

```toml
name = "MathesisEngine"
uuid = "<generar>"
version = "0.1.0"

[deps]
JSON3 = "0f8b85d8-7281-11e9-16c2-39a750bddbf1"
Symbolics = "0c5d862f-8b57-4792-8d23-62f2024744c7"
Unitful = "1986cc42-f94f-5a68-af5c-568840ba703d"
FFTW = "7a1cc6ca-52ef-59f5-83cd-3a7055c09341"
QuadGK = "1fd47b50-473d-5c70-9696-f719f8f3bcdc"
SpecialFunctions = "276daf66-3868-5448-9aa4-cd146d93841b"
CairoMakie = "13f3f980-e62b-5c42-98c6-ff1f3baf88f0"

[compat]
julia = "1.10"
```

## Estructura del motor

```
engine/src/
├── MathesisEngine.jl      ← módulo + entrypoint main()
├── rpc.jl                 ← loop NDJSON: leer stdin → dispatch → stdout
├── protocol.jl            ← tipos de mensajes (hello, eval_cell…)
├── mathjson.jl            ← MathJSON → Num/Expr de Symbolics
├── env.jl                 ← Environment: variables + funciones del doc
│                            (re-evaluación incremental, detección de deps)
├── units.jl               ← helpers Unitful (parse "m/s", quantity display)
├── eval.jl                ← evaluación numérica/simbólica de una celda
├── plot.jl                ← muestreo de funciones → arrays (para uPlot)
├── export/
│   ├── figure.jl          ← CairoMakie: plot spec → SVG/PNG bytes
│   └── latex.jl           ← documento → LaTeX
└── errors.jl              ← códigos de error de dominio
```

## Ejemplo: MathJSON → Symbolics (esquema)

```julia
# mathjson.jl — traductor (simplificado)
using Symbolics

function mj_to_symbolics(node, env)
    if node isa Number
        return Num(node)
    elseif node isa String
        return get_symbol(node, env)   # variable o constante (π, e)
    elseif node isa AbstractVector
        op = node[1]
        args = [mj_to_symbolics(a, env) for a in node[2:end]]
        return apply_op(op, args, env)
    end
end

function apply_op(op, args, env)
    op == "Add"      && return sum(args)
    op == "Multiply" && return prod(args)
    op == "Power"    && return args[1]^args[2]
    op == "Negate"   && return -args[1]
    op == "Sqrt"     && return sqrt(args[1])
    op == "Sin"      && return sin(args[1])
    # … ~60 operadores mapeados
    op == "Apply"    && return eval_user_fn(args, env)  # f(x) de usuario
    error(UnknownOperator(op))
end
```

## Entorno del documento (`env.jl`)

```julia
mutable struct DocumentEnv
    values::Dict{String,Any}        # resultado de cada celda (Num + unidad)
    functions::Dict{String,Function} # f(x) definidas en el doc
    order::Vector{String}           # orden de evaluación (dependency graph)
end
```

- Las celdas se evalúan **en orden de aparición**
- Cambiar una celda → re-evaluarla + todas las que dependen de ella
  (grafo de dependencias por referencias `{"ref": id}`)

## Unidades con Unitful

```julia
using Unitful
using Unitful: m, s, kg, °, rad, V, A

# 5 m / 2 s  →  2.5 m s⁻¹
# 1 km + 500 m → 1500 m  (conversión automática)
# Error si: 1 m + 2 s  → UnitMismatchError
```

Unidades de información (bit, byte, kB…) — Unitful tiene `UnitfulBits.jl` o se
definen a medida (fase 2).

## Render de figuras (CairoMakie — export)

```julia
using CairoMakie

function render_figure(spec; format="svg", theme=:light)
    CairoMakie.activate!(type = format)   # "svg" | "png" | "pdf"
    apply_theme!(theme)
    fig = Figure(size=(spec.width, spec.height))
    ax = Axis(fig[1,1]; xscale=spec.xType, yscale=spec.yType)
    for f in spec.functions
        lines!(ax, f.x, f.y; color=f.color, linewidth=f.width,
               linestyle=f.lineStyle)
    end
    # save a buffer en vez de archivo (devuelve bytes a Rust)
    buf = IOBuffer()
    save(buf, MIME(format), fig)
    return take!(buf)
end
```

## Sysimage con PackageCompiler (release)

```julia
# build/sysimage.jl
using PackageCompiler
create_sysimage(
    ["Symbolics", "Unitful", "FFTW", "QuadGK", "SpecialFunctions", "JSON3"];
    sysimage_path="engine/sysimage.so",   # .dylib en macOS, .dll en Windows
    precompile_execution_file="build/precompile_jl.jl"  # traza de uso
)
```

- `precompile_jl.jl` ejecuta un documento de ejemplo completo (tracing) para
  que PackageCompiler compile los métodos usados
- En desarrollo NO se usa sysimage (Julia normal + Revise)

## Arranque del motor (comando del binario)

```bash
# Dev (juliaup):
julia --project=engine engine/src/MathesisEngine.jl

# Release (app relocatable):
./mathesis-engine   # binario generado por create_app, arranca en 1-3 s
```

## Targets de rendimiento del motor

| Operación | Target |
|---|---|
| Arranque con sysimage | < 3 s |
| `eval_cell` numérico simple | < 20 ms |
| `eval_cell` con unidades | < 50 ms |
| `simplify` medianamente complejo | < 500 ms |
| `plot_data` 1000 pts | < 100 ms |
| FFT 10k puntos | < 50 ms |
