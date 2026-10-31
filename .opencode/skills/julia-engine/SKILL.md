---
name: Julia Engine
description: Load when writing or modifying the Julia sidecar engine of Mathesis (engine/) — RPC loop, MathJSON translator, DocumentEnv, Symbolics/Unitful integration, plot data, or PackageCompiler sysimage builds.
---

# Julia Engine — patrones del motor matemático

El motor es un binario Julia que habla **JSON-RPC 2.0 NDJSON por stdio**.
Spec completa del protocolo: `Documentacion/02-arquitectura/protocolo-ipc.md`.

## Esqueleto del loop RPC (`engine/src/rpc.jl`)

```julia
module MathesisEngine
using JSON3

function main()
    println(stderr, "engine ready")        # log por stderr, NUNCA stdout
    for line in eachline(stdin)            # NDJSON: un JSON por línea
        isempty(strip(line)) && continue
        req = JSON3.read(line)
        resp = handle(req)                 # dispatch por req.method
        println(stdout, JSON3.write(resp))
        flush(stdout)
    end
end

function handle(req)::JSON3.Object
    try
        result = DISPATCH[Symbol(req.method)](req.params)
        return (jsonrpc="2.0", id=req.id, result=result)
    catch e
        # Error de dominio → result.status="error" (NO error RPC)
        if e isa MathError
            return (jsonrpc="2.0", id=req.id,
                    result=(status="error", error=(code=e.code, message=e.msg)))
        end
        # Error interno → error RPC
        return (jsonrpc="2.0", id=req.id,
                error=(code=-32000, message=sprint(showerror, e)))
    end
end

end
```

**Reglas críticas:**
- stdout es SOLO para respuestas RPC — todo log va a stderr (un println
  normal en stdout corrompe el protocolo).
- Cada respuesta DEBE llevar el `id` de la petición.
- Errores matemáticos (división por cero, unidad incompatible) → dentro de
  `result`, con código de dominio (`DIV_ZERO`, `UNIT_MISMATCH`…).

## Traductor MathJSON → Symbolics (`mathjson.jl`)

MathJSON = arrays anidados: `["Add", ["Power","x",2], 1]` = `x²+1`.

```julia
using Symbolics

mj(node, env) = node isa Number ? Num(node) :
                node isa String ? lookup(node, env) :
                node isa AbstractVector ? apply(Symbol(node[1]), [mj(a, env) for a in node[2:end]]) :
                error("nodo inválido")

function apply(op, args)
    op === :Add      && return +(args...)
    op === :Multiply && return *(args...)
    op === :Power    && return args[1]^args[2]
    op === :Sin      && return sin(args[1])
    op === :Sqrt     && return sqrt(args[1])
    # … registrar más operadores aquí (catálogo abierto)
    error(UnknownOperator(op))
end
```

Añadir una función matemática nueva = añadir una línea en `apply` + su módulo
en `calc/`. Ver `Documentacion/06-capacidades/calculo-matematico.md` (las bases
ya están preparadas: MathJSON ya tiene `Derivative`, `Integrate`, `Limit`…).

## DocumentEnv — variables y funciones del worksheet

```julia
mutable struct DocumentEnv
    values::Dict{String,Any}          # cellId → resultado (Num + unidad)
    functions::Dict{String,Function}  # f(x) definidas en el doc
    deps::Dict{String,Vector{String}} # cellId → celdas de las que depende
end
```

- Evaluación en orden de aparición del documento.
- Cambio en celda X → re-evaluar X + transitivamente sus dependientes.
- Las referencias vienen en el AST como `{"ref": "<cellId>"}`.

## Unidades (Unitful)

```julia
using Unitful
uconvert(u"m", 1500u"cm")   # 15.0 m
u"km/h" |> u"m/s"           # conversión
# error si: 1u"m" + 1u"s"   → UnitMismatch (capturar → status error)
```

Los resultados van por IPC como `value` (número en unidad base) + `unit`
(string legible). Nunca serializar `Quantity` directamente.

## Plot data (para uPlot)

```julia
function plot_data(params)
    x = range(params.x.from, params.x.to; length=params.x.steps)
    series = map(params.functions) do f
        y = map(t -> safe_eval(f.ast, env, x=t), x)   # NaN donde diverge
        (id=f.id, y=y, finite=all(isfinite, y))
    end
    (status="ok", x=collect(x), series=collect(series))
end
```

Export de figura (CairoMakie) es un método distinto (`export` con
`kind="figure"`), solo en fase 2+ — lazy-load de CairoMakie con `Requires` o
import dentro de la función para no penalizar el arranque.

## Sysimage (release)

`PackageCompiler.create_sysimage([...]; precompile_execution_file="traza.jl")`
— la traza ejecuta un documento de ejemplo completo. Objetivo: arranque < 3 s.
En desarrollo: Julia normal + `Revise.jl` (hot-reload del motor).

## Testing

- Tests unitarios de `mj()` con `@test mj(["Add",1,2], env) == 3`
- Test de protocolo: pipear JSON de ejemplo por stdin al binario y comparar stdout
- `JET.jl` para análisis estático de type errors
