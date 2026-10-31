# eval.jl — evaluación de celdas, documento e INCREMENTAL (Fase 1)
#
# - eval_cell: una celda aislada (compat + tests)
# - eval_document: documento entero en orden → propagación de variables y
#   funciones de usuario entre celdas (el corazón del worksheet)
# - Evaluación incremental: con `changedCellIds` solo se re-evalúan las celdas
#   afectadas (las cambiadas + sombreado + dependientes en cascada); el resto
#   se reutiliza de DOC_CACHE reinyectando sus definiciones en el entorno.
#
# Resultados según Documentacion/02-arquitectura/protocolo-ipc.md

"""
    eval_cell(params) -> NamedTuple

params: { cellId, ast (MathJSON), env: {varName: {value: number}}, settings? }
result: { status: "ok", value: "4", unit: "1", type: "real" }
      | { status: "error", error: {code, message, cellId} }
"""
function eval_cell(params)
    cellId = string(pget(params, :cellId, ""))
    ast = pget(params, :ast, nothing)
    ast === nothing && throw(MathError("INVALID_AST", "Falta el AST de la celda"))
    digits = parse_digits(pget(params, :settings, nothing))

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
    check_finite(x)

    return (status = "ok",
            value = format_number(x, digits),
            unit = "1",
            type = "real")
end

# ── Símbolos por celda (grafo de dependencias de la eval incremental) ──────

function collect_refs!(out::Set{String}, node)
    if node isa AbstractString
        is_delim_style(node) || push!(out, node)
    elseif node isa AbstractVector
        isempty(node) && return
        # ["Function", cuerpo, params…]: los parámetros NO son referencias
        if String(node[1]) == "Function" && length(node) >= 2
            collect_refs!(out, node[2])
            return
        end
        for a in node[2:end]   # [1] = nombre del operador, no es símbolo
            collect_refs!(out, a)
        end
    end
    return
end

collect_refs(node) = (s = Set{String}(); collect_refs!(s, node); s)

"""
    cell_symbols(ctype, ast) -> (defs::Vector{String}, refs::Vector{String})

Qué define y qué usa una celda. En `Equal`/`Assign` el lado izquierdo es la
definición; el resto del AST son referencias.
"""
function cell_symbols(ctype::AbstractString, ast)
    (ctype == "text" || ast === nothing) && return (String[], String[])
    if ast isa AbstractVector && !isempty(ast) && length(ast) >= 2 &&
       String(ast[1]) in ("Equal", "Assign") && ast[2] isa AbstractString
        refs = Set{String}()
        if length(ast) >= 3
            rhs = ast[3]
            if String(ast[1]) == "Assign" && rhs isa AbstractVector &&
               !isempty(rhs) && String(rhs[1]) == "Function"
                collect_refs!(refs, rhs[2])          # cuerpo; params [3:end] fuera
            else
                collect_refs!(refs, rhs)
            end
        end
        return ([String(ast[2])], sort!(collect(refs)))
    end
    refs = Set{String}()
    collect_refs!(refs, ast)
    return (String[], sort!(collect(refs)))
end

# ── Caché de la última evaluación (corazón del incremental) ────────────────
struct CellCacheEntry
    defines::Dict{String,Float64}
    funcs::Dict{String,Tuple{Vector{String},Any}}
    result::NamedTuple
end
const DOC_CACHE = Dict{String,CellCacheEntry}()

"""
    affected_cells(cells, changed, cache) -> Set{String}

Celdas que hay que re-evaluar dado un conjunto de celdas cambiadas:
las propias cambiadas + las que definen los MISMOS símbolos (sombreado) +
las que USAN cualquier símbolo definido por las afectadas, en cascada.
Para símbolos que la cambiada DEJÓ de definir se usa también la caché
(rename: `a=2` → `c=2` debe re-evaluar a los que usaban `a`).
"""
function affected_cells(cells, changed::Vector{String}, cache::Dict{String,CellCacheEntry})
    defs_by = Dict{String,Vector{String}}()
    symbols = Dict{String,Vector{String}}()   # símbolo → cellIds que lo definen
    users = Dict{String,Vector{String}}()     # símbolo → cellIds que lo usan
    for c in cells
        cid = string(pget(c, :cellId, ""))
        defs, refs = cell_symbols(string(pget(c, :type, "expression")),
                                  pget(c, :ast, nothing))
        defs_by[cid] = defs
        for d in defs
            push!(get!(symbols, d, String[]), cid)
        end
        for r in refs
            push!(get!(users, r, String[]), cid)
        end
    end

    # Símbolos que aporta una celda cambiada: los del AST nuevo + los de su
    # caché (cubren renames: dejó de definir "a", pero "a" ya no existe)
    function contributed(cid::String)
        s = Set{String}(get(defs_by, cid, String[]))
        if haskey(cache, cid)
            union!(s, keys(cache[cid].defines))
            union!(s, keys(cache[cid].funcs))
        end
        return s
    end

    affected = Set{String}()
    queue = String[]
    for cid in changed
        if !(cid in affected)
            push!(affected, cid)
            push!(queue, cid)
        end
    end
    while !isempty(queue)
        cid = pop!(queue)
        for d in contributed(cid)
            for other in vcat(get(symbols, d, String[]), get(users, d, String[]))
                if !(other in affected)
                    push!(affected, other)
                    push!(queue, other)
                end
            end
        end
    end
    return affected
end

parse_digits(settings) = settings isa AbstractDict ?
    clamp(Int(pget(settings, :digits, 15)), 1, 17) : 15

"""
    eval_document(params) -> NamedTuple

params: { cells: [ {cellId, type, ast?, ...} ], changedCellIds?, settings? }

Recorre las celdas EN ORDEN construyendo el entorno:
- `["Equal","a",2]` (a = 2)        → define variable, resultado = valor
- `["Assign","f",["Function",…]]`   → define función de usuario (f(x) := …)
- expresión                          → evalúa con el entorno acumulado
- texto                              → sin cálculo

Con `changedCellIds` (y caché caliente) solo re-evalúa las afectadas; el
resto se replay desde DOC_CACHE. `recomputed` lista lo re-evaluado
("all" = evaluación completa).

result: { cells: [{cellId, status, value?|error?, defines?}],
          definitions: {name: value}, functions: [names], recomputed }
"""
function eval_document(params)
    cells = pget(params, :cells, nothing)
    cells === nothing && throw(MathError("INVALID_AST", "Falta cells del documento"))
    digits = parse_digits(pget(params, :settings, nothing))

    # ¿Incremental? (requiere celdas cambiadas y caché de la eval anterior)
    changed = pget(params, :changedCellIds, nothing)
    affected = nothing
    if changed isa AbstractVector && !isempty(changed) && !isempty(DOC_CACHE)
        affected = affected_cells(cells, [string(x) for x in changed], DOC_CACHE)
    end

    ctx = EvalCtx(Dict{String,Float64}())
    results = Any[]
    seen = Set{String}()

    for c in cells
        cid = string(pget(c, :cellId, ""))
        push!(seen, cid)
        if affected !== nothing && !(cid in affected) && haskey(DOC_CACHE, cid)
            # Replay: reinyectar lo que definía y reutilizar su resultado
            entry = DOC_CACHE[cid]
            merge!(ctx.vars, entry.defines)
            merge!(ctx.funcs, entry.funcs)
            push!(results, entry.result)
            continue
        end
        result = eval_one_cell(c, ctx, digits)
        push!(results, result)
        cache_store!(cid, c, result, ctx)
    end

    # Podar la caché de celdas que ya no existen en el documento
    for cid in collect(keys(DOC_CACHE))
        cid in seen || delete!(DOC_CACHE, cid)
    end

    return (cells = results,
            definitions = ctx.vars,
            functions = sort([k for (k, _) in ctx.funcs]),
            recomputed = affected === nothing ? "all" : sort!(collect(affected)))
end

"""Evaluación de UNA celda contra el ctx acumulado (muta ctx al definir)."""
function eval_one_cell(c, ctx::EvalCtx, digits::Int)
    cid = string(pget(c, :cellId, ""))
    ctype = string(pget(c, :type, "expression"))
    ast = pget(c, :ast, nothing)

    if ctype == "text"
        return (cellId = cid, status = "ok", kind = "text")
    end
    if ast === nothing
        return (cellId = cid, status = "error",
                error = (code = "INVALID_AST", message = "Falta el AST", cellId = cid))
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
            return (cellId = cid, status = "ok",
                    value = format_number(val, digits), unit = "1", type = "real",
                    defines = Dict(name => val))

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
                return (cellId = cid, status = "ok",
                        value = "$name($(join(fargs, ", ")))",
                        unit = "1", kind = "definition")
            else
                # y := 5 → definición de variable
                val = mj_eval(rhs, ctx)
                check_finite(val)
                ctx.vars[name] = val
                return (cellId = cid, status = "ok",
                        value = format_number(val, digits), unit = "1", type = "real",
                        defines = Dict(name => val))
            end
        else
            v = mj_eval(ast, ctx)
            check_finite(v)
            return (cellId = cid, status = "ok",
                    value = format_number(v, digits), unit = "1", type = "real")
        end
    catch e
        if e isa MathError
            return (cellId = cid, status = "error",
                    error = (code = e.code, message = e.message, cellId = cid))
        else
            msg = sprint(showerror, e)
            return (cellId = cid, status = "error",
                    error = (code = "INTERNAL", message = msg, cellId = cid))
        end
    end
end

"""Guarda en DOC_CACHE qué definió la celda (vars + funciones) y su resultado."""
function cache_store!(cid::String, c, result::NamedTuple, ctx::EvalCtx)
    ctype = string(pget(c, :type, "expression"))
    defs, _ = cell_symbols(ctype, pget(c, :ast, nothing))
    cdefs = Dict{String,Float64}()
    cfuncs = Dict{String,Tuple{Vector{String},Any}}()
    for d in defs
        if haskey(ctx.vars, d) && !haskey(ctx.funcs, d)
            cdefs[d] = ctx.vars[d]
        elseif haskey(ctx.funcs, d)
            cfuncs[d] = ctx.funcs[d]
        end
    end
    DOC_CACHE[cid] = CellCacheEntry(cdefs, cfuncs, result)
    return nothing
end

function check_finite(x::Float64)
    isnan(x) && throw(MathError("NAN", "Resultado no es un número"))
    isinf(x) && throw(MathError("INFINITY", "Resultado infinito (overflow o división por cero)"))
    return nothing
end

# Formato: 4 en vez de 4.0 para enteros; `digits` dígitos significativos
# (configurables por documento vía settings.digits, Fase 1)
function format_number(x::Float64, digits::Int = 15)::String
    if isinteger(x) && abs(x) < 1e15
        return string(round(Int64, x))
    end
    return string(round(x; sigdigits = digits))
end
