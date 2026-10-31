# mathjson.jl — traductor MathJSON → evaluación numérica
#
# MathJSON = arrays anidados (estándar abierto de MathLive/MathJSON),
# parseado SIEMPRE con canonical:false desde el frontend (AST puro:
# ["Divide",1,0] sin evaluar, sin ["Rational",…]).
#
# Contexto de evaluación (Fase 1): EvalCtx transporta variables + funciones de
# usuario definidas en el documento (ver eval.jl → eval_document).
# Añadir una función = añadir un case en apply_op (catálogo abierto).

"""
    EvalCtx

Estado de evaluación del documento:
- `vars`:  variables definidas (`a = 2` → nombre ⇒ Float64)
- `funcs`: funciones de usuario (`f(x) := …` → nombre ⇒ (parámetros, AST cuerpo))
- `depth`: guardia de recursión para funciones de usuario
"""
mutable struct EvalCtx
    vars::Dict{String,Float64}
    funcs::Dict{String,Tuple{Vector{String},Any}}
    depth::Int
end
EvalCtx(vars::Dict{String,Float64}) = EvalCtx(vars, Dict{String,Tuple{Vector{String},Any}}(), 0)

const MAX_FUNC_DEPTH = 64

# Estilos de delimitador de MathLive ("'(,)'", "'[]'") — NO son expresiones
is_delim_style(x) = x isa AbstractString && occursin(r"^'.*'$", x)

# Evalúa un nodo MathJSON a Float64 con el contexto dado.
mj_eval(node, env::Dict{String,Float64}) = mj_eval(node, EvalCtx(copy(env)))

function mj_eval(node, ctx::EvalCtx)::Float64
    if node isa Real
        return Float64(node)
    elseif node isa AbstractString
        # Nodos numéricos especiales (JSON no admite NaN/Infinity literales)
        node == "NaN" && throw(MathError("NAN", "La expresión evalúa a NaN (¿división 0/0 o ∞−∞?)"))
        (node == "Infinity" || node == "+Infinity") &&
            throw(MathError("INFINITY", "La expresión evalúa a ±∞ (¿división entre cero?)"))
        node == "-Infinity" &&
            throw(MathError("INFINITY", "La expresión evalúa a −∞ (¿división entre cero?)"))
        # Variables del documento y constantes
        haskey(ctx.vars, node) && return ctx.vars[node]
        (node == "π" || node == "Pi") && return Float64(π)
        node == "e" && return exp(1.0)
        haskey(ctx.funcs, node) &&
            throw(MathError("FUNC_AS_VALUE", "$node es una función; usa $node(...)"))
        throw(MathError("UNDEFINED_VAR", "Variable no definida: $node"))
    elseif node isa AbstractVector
        isempty(node) && throw(MathError("INVALID_AST", "Nodo MathJSON vacío"))
        op = String(node[1])
        raw = Any[a for a in node[2:end]]

        # Llamada a función de usuario: f(...) → [InvisibleOperator, "f", args]
        if op == "InvisibleOperator" && !isempty(raw) && raw[1] isa AbstractString &&
           haskey(ctx.funcs, String(raw[1]))
            return call_user_function(String(raw[1]), raw[2:end], ctx)
        end

        # Delimiter/Sequence: trabajan con nodos crudos (estilos, secuencias)
        if op == "Delimiter"
            els = Any[e for e in raw if !is_delim_style(e)]
            isempty(els) && throw(MathError("INVALID_AST", "Paréntesis vacíos"))
            length(els) == 1 && return mj_eval(els[1], ctx)
            # (a, b) suelto = tupla → arrays en Fase 3
            throw(MathError("UNSUPPORTED", "Tuplas/listas: soporte de arrays en Fase 3"))
        elseif op == "Sequence"
            els = Any[e for e in raw if !is_delim_style(e)]
            isempty(els) && throw(MathError("INVALID_AST", "Expresión vacía"))
            length(els) == 1 && return mj_eval(els[1], ctx)
            throw(MathError("UNSUPPORTED", "Tuplas/listas: soporte de arrays en Fase 3"))
        elseif op == "Equal" || op == "Assign"
            throw(MathError("INVALID_CTX",
                "Las definiciones (= y :=) solo valen al inicio de una celda"))
        end

        args = Float64[mj_eval(a, ctx) for a in raw]
        return apply_op(op, args)
    else
        throw(MathError("INVALID_AST", "Nodo MathJSON no soportado: $(typeof(node))"))
    end
end

# Aplicación de función de usuario con aplanado de argumentos:
#   f(3)     → [InvisibleOperator, f, Delimiter[3]]
#   f(x,y)   → [InvisibleOperator, f, Delimiter[Sequence x y, '(,)']]
function call_user_function(name::String, raw_args, ctx::EvalCtx)::Float64
    params, body = ctx.funcs[name]
    args = flatten_call_args(raw_args)
    if length(args) != length(params)
        throw(MathError("ARITY",
            "$name espera $(length(params)) argumento(s), recibió $(length(args))"))
    end
    ctx.depth >= MAX_FUNC_DEPTH &&
        throw(MathError("RECURSION", "Recursión demasiado profunda en $name (máx $MAX_FUNC_DEPTH)"))
    inner = copy(ctx.vars)
    for (p, a) in zip(params, args)
        inner[p] = mj_eval(a, ctx)
    end
    return mj_eval(body, EvalCtx(inner, ctx.funcs, ctx.depth + 1))
end

flatten_call_args(items) = vcat((flatten_call_one(x) for x in items)...)

function flatten_call_one(x)::Vector{Any}
    if x isa AbstractVector && !isempty(x)
        op = String(x[1])
        rest = Any[a for a in x[2:end] if !is_delim_style(a)]
        op == "Sequence" && return flatten_call_args(rest)
        op == "Delimiter" && return flatten_call_args(rest)
    end
    is_delim_style(x) && return Any[]
    return Any[x]
end

function apply_op(op::String, a::Vector{Float64})::Float64
    if op == "Add"
        return sum(a)
    elseif op == "Subtract"
        length(a) == 1 && return -a[1]
        return reduce(-, a)
    elseif op == "Multiply"
        return prod(a)
    elseif op == "Divide"
        length(a) == 2 || throw(MathError("INVALID_AST", "Divide necesita 2 argumentos"))
        iszero(a[2]) && throw(MathError("DIV_ZERO", "División entre cero"))
        return a[1] / a[2]
    elseif op == "Power"
        length(a) == 2 || throw(MathError("INVALID_AST", "Power necesita 2 argumentos"))
        return a[1]^a[2]
    elseif op == "Negate"
        return -a[1]
    elseif op == "Sqrt"
        a[1] < 0 && throw(MathError("DOMAIN", "Raíz cuadrada de número negativo"))
        return sqrt(a[1])
    elseif op == "Exp"
        return exp(a[1])
    elseif op == "Abs"
        return abs(a[1])
    # Multiplicación implícita (2(x+1)) cuando NO es llamada de función
    elseif op == "InvisibleOperator" || op == "InvisibleTimes"
        isempty(a) && throw(MathError("INVALID_AST", "Expresión incompleta"))
        return prod(a)
    elseif op == "Tuple"
        isempty(a) && throw(MathError("INVALID_AST", "Paréntesis vacíos"))
        throw(MathError("UNSUPPORTED", "Listas/tuplas: soporte de arrays en Fase 3"))
    elseif op == "Sequence"
        isempty(a) && throw(MathError("INVALID_AST", "Expresión vacía"))
        return a[end]
    else
        throw(MathError("UNKNOWN_OP", "Operación no soportada aún: $op"))
    end
end
