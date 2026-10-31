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
- `vars`:  variables definidas (`a = 2` → nombre ⇒ número O cantidad Unitful)
- `funcs`: funciones de usuario (`f(x) := …` → nombre ⇒ (parámetros, AST cuerpo))
- `depth`: guardia de recursión para funciones de usuario
"""
mutable struct EvalCtx
    # Dict{String,Any} Y NO {String,Real}: convert(Real, ::Quantity) de
    # Unitful hace uconvert adimensional → DimensionError en setindex!
    vars::Dict{String,Any}
    funcs::Dict{String,Tuple{Vector{String},Any}}
    depth::Int
end
EvalCtx(vars::AbstractDict) =
    EvalCtx(Dict{String,Any}(String(k) => v for (k, v) in vars),
            Dict{String,Tuple{Vector{String},Any}}(), 0)

const MAX_FUNC_DEPTH = 64

# Funciones con nombre que MathJSON emite como llamada implícita:
#   \exp(x)      → ["InvisibleOperator","Exp",["Delimiter","x"]]
#   \gcd(12,18)  → ["InvisibleOperator","GCD",["Delimiter",["Sequence",12,18],…]]
#   \operatorname{sign}(x) → ["InvisibleOperator","sign",["Delimiter","x"]]
# El nombre va como PRIMER argumento de InvisibleOperator — hay que
# interceptarlo ANTES de evaluar los args (un string suelto daría UNDEFINED_VAR).
const BUILTIN_NAMED = Dict{String,String}(
    "GCD" => "GCD", "gcd" => "GCD",
    "LCM" => "LCM", "lcm" => "LCM",
    "Exp" => "Exp", "exp" => "Exp",
    "sign" => "Sign", "Sign" => "Sign", "Sgn" => "Sign",
    "abs" => "Abs", "sqrt" => "Sqrt",
    "min" => "Min", "max" => "Max",
    "ln" => "Ln", "log" => "Log",
    "Mod" => "Mod", "mod" => "Mod",
)

# f^{-1}(x) → ["Apply",["InverseFunction","Sin"],"x"] (canonical:false de
# compute-engine). Inversa de NAME ⇒ operador "Arc" + NAME en minúscula.
const INVERSE_FUNCTIONS = Dict{String,String}(
    "Sin" => "Arcsin", "Cos" => "Arccos", "Tan" => "Arctan",
    "Sec" => "Arcsec", "Csc" => "Arccsc",
    "Sinh" => "Arcsinh", "Cosh" => "Arccosh", "Tanh" => "Arctanh",
)

# Estilos de delimitador de MathLive ("'(,)'", "'[]'") — NO son expresiones
is_delim_style(x) = x isa AbstractString && occursin(r"^'.*'$", x)

# Dominio estricto → MathError("DOMAIN") en vez de DomainError crudo
function dcheck(f::Function, x::Float64)::Float64
    try
        return f(x)
    catch e
        e isa DomainError &&
            throw(MathError("DOMAIN", "Valor fuera del dominio de la función"))
        rethrow()
    end
end

# Cantidad «negativa»: comparar Quantity con 0 crudo lanza DimensionError —
# se compara el valor EN SU UNIDAD (−8 km es negativo ✓)
is_negative(x)::Bool = x isa Quantity ? qvalue(x) < 0 : x < 0

# Signo ±1 SIEMPRE adimensional (para cantidades se usa el valor en SU unidad)
sign_value(x)::Float64 = sign(x isa Quantity ? qvalue(x) : x)

# Evalúa un nodo MathJSON a Real (número o cantidad Unitful Fase 2).
mj_eval(node, env::AbstractDict) = mj_eval(node, EvalCtx(env))

# NOTA: sin anotación ::Real — convert(Real, ::Quantity) de Unitful
# intenta uconvert a adimensional y truena con DimensionError.
function mj_eval(node, ctx::EvalCtx)
    if node isa Real
        return Float64(node)
    elseif node isa AbstractString
        # Nodos numéricos especiales (JSON no admite NaN/Infinity literales)
        node == "NaN" && throw(MathError("NAN", "La expresión evalúa a NaN (¿división 0/0 o ∞−∞?)"))
        (node == "Infinity" || node == "+Infinity") &&
            throw(MathError("INFINITY", "La expresión evalúa a ±∞ (¿división entre cero?)"))
        node == "-Infinity" &&
            throw(MathError("INFINITY", "La expresión evalúa a −∞ (¿división entre cero?)"))
        node == "PositiveInfinity" &&
            throw(MathError("INFINITY", "La expresión evalúa a +∞ (¿división entre cero?)"))
        node == "NegativeInfinity" &&
            throw(MathError("INFINITY", "La expresión evalúa a −∞ (¿división entre cero?)"))
        # Variables del documento y constantes
        haskey(ctx.vars, node) && return ctx.vars[node]
        (node == "π" || node == "Pi") && return Float64(π)
        node == "e" && return exp(1.0)
        haskey(ctx.funcs, node) &&
            throw(MathError("FUNC_AS_VALUE", "$node es una función; usa $node(...)"))
        # Unidades (Fase 2): "m", "km", "'°C'"… → 1.0·unidad. Si una variable
        # se llama igual, YA ha ganado arriba.
        q = unit_leaf(node)
        q !== nothing && return q
        throw(MathError("UNDEFINED_VAR", "Variable no definida: $node"))
    elseif node isa AbstractVector
        isempty(node) && throw(MathError("INVALID_AST", "Nodo MathJSON vacío"))
        op = String(node[1])
        raw = Any[a for a in node[2:end]]

        # LaTeX roto/incompleto: compute-engine emite ["Error",…] — avisar claro
        op == "Error" && throw(MathError("LATEX_INCOMPLETE",
            "Expresión LaTeX incompleta o no soportada"))

        # Llamada: f(...) de USUARIO, o función con nombre integrada — MathJSON
        # emite \exp(x) como ["InvisibleOperator","Exp",["Delimiter","x"]] y
        # \gcd(12,18) como ["InvisibleOperator","GCD",["Delimiter",["Sequence",…]]].
        # El nombre va como PRIMER arg: interceptarlo ANTES de evaluar los args
        # (un string suelto daría UNDEFINED_VAR).
        if op == "InvisibleOperator" && !isempty(raw) && raw[1] isa AbstractString
            fname = String(raw[1])
            if haskey(ctx.funcs, fname)
                return call_user_function(fname, raw[2:end], ctx)
            elseif haskey(BUILTIN_NAMED, fname)
                args = Any[mj_eval(a, ctx) for a in flatten_call_args(raw[2:end])]
                return apply_op(BUILTIN_NAMED[fname], args)
            end
        end

        # Apply: f^{-1}(x) → ["Apply",["InverseFunction","Sin"],"x"] (canonical:false)
        if op == "Apply"
            isempty(raw) && throw(MathError("INVALID_AST", "Apply sin función"))
            fn = raw[1]
            fname = if fn isa AbstractVector && !isempty(fn) && String(fn[1]) == "InverseFunction"
                length(fn) >= 2 ||
                    throw(MathError("INVALID_AST", "InverseFunction sin argumento"))
                inv = String(fn[2])
                haskey(INVERSE_FUNCTIONS, inv) ||
                    throw(MathError("UNKNOWN_OP", "Función inversa no soportada: $inv"))
                INVERSE_FUNCTIONS[inv]
            elseif fn isa AbstractString
                String(fn)
            else
                throw(MathError("UNKNOWN_OP", "Apply con función no soportada"))
            end
            args = Any[mj_eval(a, ctx) for a in raw[2:end]]
            return apply_op(fname, args)
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
        elseif op == "To"
            # Conversión: 1\,\text{km} → 1000\,\text{m} — convierte a la
            # UNIDAD del destino (el número del destino se ignora).
            length(raw) == 2 ||
                throw(MathError("INVALID_AST", "→ necesita origen y destino"))
            qa = mj_eval(raw[1], ctx)
            qb = mj_eval(raw[2], ctx)
            qa isa Quantity ||
                throw(MathError("UNIT_MISMATCH",
                    "→ el origen debe tener unidades (p.ej. 1\\,\\text{km} → 1\\,\\text{m})"))
            qb isa Quantity ||
                throw(MathError("UNIT_MISMATCH", "→ el destino debe tener unidades"))
            try
                return uconvert(unit(qb), qa)
            catch e
                unitful_to_matherror(e)
                rethrow()
            end
        end

        args = Any[mj_eval(a, ctx) for a in raw]   # eltype Any: sin convert(Real,·)
        return apply_op(op, args)
    else
        throw(MathError("INVALID_AST", "Nodo MathJSON no soportado: $(typeof(node))"))
    end
end

# Aplicación de función de usuario con aplanado de argumentos:
#   f(3)     → [InvisibleOperator, f, Delimiter[3]]
#   f(x,y)   → [InvisibleOperator, f, Delimiter[Sequence x y, '(,)']]
function call_user_function(name::String, raw_args, ctx::EvalCtx)
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

"""
    apply_op(op, args) -> Real

Aplica un operador MathJSON. Traduce los errores de Unitful a MathError de
dominio: DimensionError → UNIT_MISMATCH, AffineError (°C) → UNIT_AFFINE,
MethodError/ErrorException (op no definida para cantidades) → UNIT_OP.
"""
function apply_op(op::String, a::AbstractVector)
    try
        return apply_op_impl(op, a)
    catch e
        e isa MathError && rethrow()
        unitful_to_matherror(e)   # DimensionError/AffineError → throw
        if e isa MethodError || e isa ErrorException
            throw(MathError("UNIT_OP", "Operación no válida con estas unidades: " *
                first(sprint(showerror, e), 160)))
        end
        rethrow()
    end
end

function apply_op_impl(op::String, a::AbstractVector)
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
        a[2] isa Quantity && dimension(a[2]) != NoDims &&
            throw(MathError("UNIT_MISMATCH", "El exponente debe ser adimensional"))
        return a[1]^a[2]
    elseif op == "Negate"
        return -a[1]
    elseif op == "Sqrt"
        is_negative(a[1]) && throw(MathError("DOMAIN", "Raíz cuadrada de número negativo"))
        return sqrt(a[1])
    elseif op == "Exp"
        return exp(dimless_val("exp", a[1]))
    elseif op == "Abs"
        return abs(a[1])
    # ── Trigonométricas: el argumento va a RADIANES (sin(90°)=1) ──────────
    elseif op == "Sin"
        return sin(rad_arg("sin", a[1]))
    elseif op == "Cos"
        return cos(rad_arg("cos", a[1]))
    elseif op == "Tan"
        return tan(rad_arg("tan", a[1]))
    elseif op == "Cot"
        x = rad_arg("cot", a[1])
        return cos(x) / sin(x)   # Cot(0)=Inf → INFINITY vía check_finite
    elseif op == "Sec"
        x = rad_arg("sec", a[1])
        return 1 / cos(x)
    elseif op == "Csc"
        x = rad_arg("csc", a[1])
        return 1 / sin(x)
    elseif op == "Arcsin" || op == "Asin"
        return dcheck(asin, dimless_val("arcsin", a[1]))
    elseif op == "Arccos" || op == "Acos"
        return dcheck(acos, dimless_val("arccos", a[1]))
    elseif op == "Arctan" || op == "Atan"
        return atan(dimless_val("arctan", a[1]))
    elseif op == "Arcsec"
        return dcheck(x -> acos(1 / x), dimless_val("arcsec", a[1]))
    elseif op == "Arccsc"
        return dcheck(x -> asin(1 / x), dimless_val("arccsc", a[1]))
    # ── Hiperbólicas y sus inversas (adimensionales) ──
    elseif op == "Sinh"
        return sinh(dimless_val("sinh", a[1]))
    elseif op == "Cosh"
        return cosh(dimless_val("cosh", a[1]))
    elseif op == "Tanh"
        return tanh(dimless_val("tanh", a[1]))
    elseif op == "Arcsinh" || op == "Asinh"
        return asinh(dimless_val("arsinh", a[1]))
    elseif op == "Arccosh" || op == "Acosh"
        return dcheck(acosh, dimless_val("arcosh", a[1]))
    elseif op == "Arctanh" || op == "Atanh"
        return dcheck(atanh, dimless_val("artanh", a[1]))
    # ── Logaritmos: Ln = natural, Log = base 10 (o ["Log", x, base]), Lb = base 2 ──
    elseif op == "Ln"
        return dcheck(log, dimless_val("ln", a[1]))
    elseif op == "Log"
        length(a) == 1 && return dcheck(log10, dimless_val("log", a[1]))
        length(a) == 2 || throw(MathError("INVALID_AST", "Log necesita 1 o 2 argumentos"))
        x = dimless_val("log", a[1])
        b = dimless_val("log", a[2])
        (b > 0 && b != 1) ||
            throw(MathError("DOMAIN", "Base de logaritmo inválida: $b"))
        return dcheck(t -> log(t) / log(b), x)
    elseif op == "Lb"
        return dcheck(log2, dimless_val("lb", a[1]))
    elseif op == "Max"
        isempty(a) && throw(MathError("INVALID_AST", "Max necesita argumentos"))
        return maximum(a)
    elseif op == "Min"
        isempty(a) && throw(MathError("INVALID_AST", "Min necesita argumentos"))
        return minimum(a)
    # ── Raíces, redondeo, combinatoria y enteros ──
    elseif op == "Root"      # ["Root", x, n] = n-ésima raíz de x (\sqrt[n]{x})
        length(a) == 2 || throw(MathError("INVALID_AST", "Root necesita 2 argumentos"))
        x, n = a[1], dimless_val("Root", a[2])
        n == 0 && throw(MathError("DOMAIN", "Raíz de orden 0"))
        if n == floor(n) && abs(n) < 1e9
            ni = Int(n)
            if iseven(ni)
                is_negative(x) &&
                    throw(MathError("DOMAIN", "Raíz de orden par de número negativo"))
                return x^(1 / n)
            end
            # orden impar: definida para todo ℝ (−8^(1/3) = −2)
            return sign_value(x) * abs(x)^(1 / n)
        end
        is_negative(x) &&
            throw(MathError("DOMAIN", "Raíz de orden no entero de número negativo"))
        return x^(1 / n)
    elseif op == "Floor"
        # Unitful rechaza floor(::Quantity) — redondeo manual EN SU UNIDAD
        return a[1] isa Quantity ? qround(floor, a[1]) : floor(a[1])
    elseif op == "Ceil" || op == "Ceiling"
        return a[1] isa Quantity ? qround(ceil, a[1]) : ceil(a[1])
    elseif op == "Round"   # mitad arriba (ties away): 2.5→3, -2.5→3 (paridad con JS Math.round)
        return a[1] isa Quantity ?
            qround(x -> round(x, RoundNearestTiesAway), a[1]) :
            round(a[1], RoundNearestTiesAway)
    elseif op == "Sign" || op == "Sgn"
        return sign_value(a[1])   # ±1 SIEMPRE adimensional
    elseif op == "Factorial"
        x = dimless_val("factorial", a[1])
        (x >= 0 && x == floor(x)) ||
            throw(MathError("DOMAIN", "Factorial definido para enteros ≥ 0"))
        x > 170 && throw(MathError("INFINITY", "Factorial desbordado (x > 170)"))
        return Float64(factorial(Int(x)))
    elseif op == "GCD"
        v = [dimless_val("gcd", x) for x in a]
        (isempty(v) || !all(x -> x == floor(x), v)) &&
            throw(MathError("DOMAIN", "GCD requiere enteros"))
        return Float64(reduce(gcd, round.(Int, v)))
    elseif op == "LCM"
        v = [dimless_val("lcm", x) for x in a]
        (isempty(v) || !all(x -> x == floor(x), v)) &&
            throw(MathError("DOMAIN", "LCM requiere enteros"))
        return Float64(reduce(lcm, round.(Int, v)))
    elseif op == "Mod"
        length(a) == 2 || throw(MathError("INVALID_AST", "Mod necesita 2 argumentos"))
        iszero(a[2]) && throw(MathError("DIV_ZERO", "Módulo entre cero"))
        return mod(a[1], a[2])
    # Multiplicación implícita (2(x+1) y 5\,\text{m}) cuando NO es llamada de función
    elseif op == "InvisibleOperator" || op == "InvisibleTimes"
        isempty(a) && throw(MathError("INVALID_AST", "Expresión incompleta"))
        aff = findfirst(x -> x isa Quantity && unit(x) isa Unitful.AffineUnits, a)
        if aff !== nothing
            # Literal affine: 100·(1.0 °C) — Unitful prohíbe escalar cantidades
            # affine → se REINTERPRETA el valor en su unidad (100 °C ✓)
            others = [a[i] for i in eachindex(a) if i != aff]
            return prod(others) * unit(a[aff])
        end
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
