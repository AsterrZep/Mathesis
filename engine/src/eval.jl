# eval.jl — evaluación de celdas del worksheet
#
# eval_cell: MathJSON de la celda + entorno → resultado con metadatos.
# El resultado sigue el spec de Documentacion/02-arquitectura/protocolo-ipc.md.

"""
    eval_cell(params) -> NamedTuple

params: { cellId, ast (MathJSON), env: {varName: {value: number}} }
result: { status: "ok", value: "4", unit: "1", type: "real" }
      | { status: "error", error: {code, message, cellId} }
"""
function eval_cell(params)
    cellId = string(pget(params, :cellId, ""))
    ast = pget(params, :ast, nothing)
    ast === nothing && throw(MathError("INVALID_AST", "Falta el AST de la celda"))

    # Entorno de variables (resultados previos del documento, unidades ignoradas en Fase 0)
    env = Dict{String,Float64}()
    env_obj = pget(params, :env, nothing)
    if env_obj isa AbstractDict
        for (name, spec) in pairs(env_obj)
            v = spec isa Real ? spec : pget(spec, :value, nothing)
            env[string(name)] = Float64(v)   # lanza si no es numérico → INTERNAL
        end
    end

    x = mj_eval(ast, env)

    # Inf/NaN con motivo claro (overflow, 0/0 no cubierto por DIV_ZERO…)
    if isnan(x)
        throw(MathError("NAN", "Resultado no es un número"))
    elseif isinf(x)
        throw(MathError("INFINITY", "Resultado infinito (overflow o división por cero)"))
    end

    return (status = "ok",
            value = format_number(x),
            unit = "1",
            type = "real")
end

# Formato legible: 4 en vez de 4.0 para enteros; máx. 15 dígitos significativos
function format_number(x::Float64)::String
    if isinteger(x) && abs(x) < 1e15
        return string(round(Int64, x))
    end
    # Trim de flotantes: repr corto y estable
    s = string(x)
    return s
end
