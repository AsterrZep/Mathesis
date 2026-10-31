# mathjson.jl — traductor MathJSON → evaluación numérica
#
# MathJSON = arrays anidados (estándar abierto de MathLive/MathJSON),
# parseado SIEMPRE con canonical:false desde el frontend, de modo que el
# AST llega puro (["Divide",1,0] sin evaluar, sin ["Rational",…]).
#
# Fase 0: aritmética + delimitadores + multiplicación implícita.
# Fases posteriores: trig, unidades, Symbolics
# (ver Documentacion/06-capacidades/calculo-matematico.md).
# Añadir una función = añadir un case en apply_op (catálogo abierto).

# Evalúa un nodo MathJSON a Float64, con entorno de variables.
function mj_eval(node, env::Dict{String,Float64})::Float64
    if node isa Real
        return Float64(node)
    elseif node isa AbstractString
        # Nodos numéricos especiales (JSON no admite NaN/Infinity literales;
        # si alguna fuente los emite como string, dar error de dominio claro
        # en vez de "variable no definida")
        node == "NaN" && throw(MathError("NAN", "La expresión evalúa a NaN (¿división 0/0 o ∞−∞?)"))
        (node == "Infinity" || node == "+Infinity") &&
            throw(MathError("INFINITY", "La expresión evalúa a +∞ (¿división entre cero?)"))
        node == "-Infinity" &&
            throw(MathError("INFINITY", "La expresión evalúa a −∞ (¿división entre cero?)"))
        # Variables del entorno y constantes
        haskey(env, node) && return env[node]
        (node == "π" || node == "Pi") && return Float64(π)
        node == "e" && return exp(1.0)
        throw(MathError("UNDEFINED_VAR", "Variable no definida: $node"))
    elseif node isa AbstractVector
        isempty(node) && throw(MathError("INVALID_AST", "Nodo MathJSON vacío"))
        op = String(node[1])
        args = Float64[mj_eval(a, env) for a in node[2:end]]
        return apply_op(op, args)
    else
        throw(MathError("INVALID_AST", "Nodo MathJSON no soportado: $(typeof(node))"))
    end
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
    # ── Nodos estructurales (canonical:false de compute-engine) ──────────
    elseif op == "Delimiter"
        # Paréntesis/llaves/corchetes: transparentes. (Delimiter) vacío → error.
        length(a) == 1 || throw(MathError("INVALID_AST", "Paréntesis vacíos"))
        return a[1]
    elseif op == "InvisibleOperator"
        # Multiplicación implícita: 2(x+1) → [InvisibleOperator, 2, (x+1)]
        isempty(a) && throw(MathError("INVALID_AST", "Expresión incompleta"))
        return prod(a)
    elseif op == "Tuple"
        # canonical:false produce ["Tuple"] para () vacío…
        isempty(a) && throw(MathError("INVALID_AST", "Paréntesis vacíos"))
        # …con elementos = listas (arrays llegan en Fase 3)
        throw(MathError("UNSUPPORTED", "Listas/tuplas: soporte de arrays en Fase 3"))
    elseif op == "Sequence"
        isempty(a) && throw(MathError("INVALID_AST", "Expresión vacía"))
        return a[end]   # secuencia puntual → último valor (p.ej. rangos futuros)
    elseif op == "InvisibleTimes"
        return prod(a)
    else
        throw(MathError("UNKNOWN_OP", "Operación no soportada aún: $op"))
    end
end
