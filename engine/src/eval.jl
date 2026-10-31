# eval.jl — evaluación de celdas y del documento completo
#
# Fase 1:
# - eval_cell: una celda aislada (compat + tests)
# - eval_document: documento entero en orden → propagación de variables y
#   funciones de usuario entre celdas (el corazón del worksheet)
#
# Resultados según Documentacion/02-arquitectura/protocolo-ipc.md

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

    # Entorno de variables externo (unidades ignoradas en Fase 1)
    env = Dict{String,Float64}()
    env_obj = pget(params, :env, nothing)
    if env_obj isa AbstractDict
        for (name, spec) in pairs(env_obj)
            v = spec isa Real ? spec : pget(spec, :value, nothing)
            env[string(name)] = Float64(v)   # lanza si no es numérico → INTERNAL
        end
    end

    x = mj_eval(ast, EvalCtx(env))

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

"""
    eval_document(params) -> NamedTuple

params: { cells: [ {cellId, type: "equation"|"expression"|"text", ast?, ...} ] }

Recorre las celdas EN ORDEN construyendo el entorno:
- `["Equal","a",2]` (a = 2)        → define variable, resultado = valor
- `["Assign","f",["Function",…]]`   → define función de usuario (f(x) := …)
- expresión                          → evalúa con el entorno acumulado
- texto                              → sin cálculo

result: { cells: [{cellId, status, value?|error?, defines?}],
          definitions: {name: value}, functions: [names] }
"""
function eval_document(params)
    cells = pget(params, :cells, nothing)
    cells === nothing && throw(MathError("INVALID_AST", "Falta cells del documento"))

    ctx = EvalCtx(Dict{String,Float64}())
    results = Any[]

    for c in cells
        cid = string(pget(c, :cellId, ""))
        ctype = string(pget(c, :type, "expression"))
        ast = pget(c, :ast, nothing)

        if ctype == "text"
            push!(results, (cellId = cid, status = "ok", kind = "text"))
            continue
        end
        if ast === nothing
            push!(results, (cellId = cid, status = "error",
                error = (code = "INVALID_AST", message = "Falta el AST", cellId = cid)))
            continue
        end

        try
            if ast isa AbstractVector && !isempty(ast) && String(ast[1]) == "Equal"
                # a = 2 → definición de variable
                lhs = ast[2]
                if !(lhs isa AbstractString)
                    throw(MathError("UNSUPPORTED",
                        "El lado izquierdo de = debe ser un símbolo simple"))
                end
                name = String(lhs)
                val = mj_eval(ast[3], ctx)
                check_finite(val)
                ctx.vars[name] = val
                push!(results, (cellId = cid, status = "ok",
                    value = format_number(val), unit = "1", type = "real",
                    defines = Dict(name => val)))

            elseif ast isa AbstractVector && !isempty(ast) && String(ast[1]) == "Assign"
                # f(x) := … (o y := 5 como Assign plano)
                lhs = ast[2]
                lhs isa AbstractString ||
                    throw(MathError("UNSUPPORTED", "El nombre debe ser un símbolo simple"))
                name = String(lhs)
                rhs = ast[3]
                if rhs isa AbstractVector && !isempty(rhs) && String(rhs[1]) == "Function"
                    body = rhs[2]
                    fargs = String[string(a) for a in rhs[3:end]]
                    ctx.funcs[name] = (fargs, body)
                    push!(results, (cellId = cid, status = "ok",
                        value = "$name($(join(fargs, ", ")))",
                        unit = "1", kind = "definition"))
                else
                    # y := 5 → definición de variable
                    val = mj_eval(rhs, ctx)
                    check_finite(val)
                    ctx.vars[name] = val
                    push!(results, (cellId = cid, status = "ok",
                        value = format_number(val), unit = "1", type = "real",
                        defines = Dict(name => val)))
                end
            else
                v = mj_eval(ast, ctx)
                check_finite(v)
                push!(results, (cellId = cid, status = "ok",
                    value = format_number(v), unit = "1", type = "real"))
            end
        catch e
            if e isa MathError
                push!(results, (cellId = cid, status = "error",
                    error = (code = e.code, message = e.message, cellId = cid)))
            else
                msg = sprint(showerror, e)
                push!(results, (cellId = cid, status = "error",
                    error = (code = "INTERNAL", message = msg, cellId = cid)))
            end
        end
    end

    return (cells = results,
            definitions = ctx.vars,
            functions = sort([k for (k, _) in ctx.funcs]))
end

function check_finite(x::Float64)
    isnan(x) && throw(MathError("NAN", "Resultado no es un número"))
    isinf(x) && throw(MathError("INFINITY", "Resultado infinito (overflow o división por cero)"))
    return nothing
end

# Formato legible: 4 en vez de 4.0 para enteros; máx. 15 dígitos significativos
function format_number(x::Float64)::String
    if isinteger(x) && abs(x) < 1e15
        return string(round(Int64, x))
    end
    return string(x)
end
