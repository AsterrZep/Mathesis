# units.jl — Unidades con Unitful.jl (Fase 2)
#
# Papel en el pipeline:
# 1. HOJA DE SÍMBOLOS: `5\,\text{m}` llega como ["InvisibleOperator",5,"m"];
#    la hoja "m" (string) se resuelve aquí → 1.0 m (cantidad). Si el usuario
#    define una variable "m", LA VARIABLE GANA (se comprueba antes).
# 2. PARSE de cadenas "m s^-1": round-trip JSON → engine para definitions
#    del documento y `plot_data` env (el JSON no puede llevar objetos Unitful).
# 3. Unidades de INFORMACIÓN: definiciones custom con dimensión propia
#    (checklist: "como el original" — UnitfulBits no está en el registry).
#
# Decisiones de diseño (Documentacion/03-tecnologias/julia.md):
# - Ángulos (°/rad) son adimensionales en Unitful: sin(90°) funciona solo
#   si la cantidad pasa a Unitful; nosotros convertimos a radianes (rad_arg).
# - °C es AFINE: no admite suma de dos °C (AffineError) — se mapea a error
#   de dominio con mensaje claro; → a °C/K sí funciona.

using Unitful
using Unitful: DimensionError, AffineError, NoDims, NoUnits, dimension,
    uconvert, ustrip, unit, Quantity

# ── Unidades de información (dimensión propia; NO se mezclan con SI) ───────
@dimension infodim "inf" InfoDim
@refunit bit "bit" Bit infodim false
@unit byte "B" Byte 8bit false
@unit kB "kB" Kilobyte 1000byte false
@unit MB "MB" Megabyte 1000kB false

# ── Hoja de símbolos: nombre (como lo escribe MathLive en \text{}) → unidad
# Valores vía u"" (parse-time): resuelve prefijos/unicode de Unitful y busca
# las unidades custom de ESTE módulo (bit/byte/kB/MB, definidas arriba).
const ATOMS = Dict{String,Any}(
    # longitud
    "m" => u"m", "cm" => u"cm", "km" => u"km", "mm" => u"mm",
    "μm" => u"μm", "um" => u"μm", "nm" => u"nm",
    # tiempo y frecuencia
    "s" => u"s", "ms" => u"ms", "ns" => u"ns",
    "min" => u"minute", "minute" => u"minute",
    "h" => u"hr", "hr" => u"hr",
    "Hz" => u"Hz", "kHz" => u"kHz", "MHz" => u"MHz", "GHz" => u"GHz",
    # masa
    "kg" => u"kg", "g" => u"g", "mg" => u"mg",
    # fuerza, presión, energía, potencia
    "N" => u"N", "kN" => u"kN", "Pa" => u"Pa", "kPa" => u"kPa",
    "MPa" => u"MPa", "bar" => u"bar",
    "J" => u"J", "kJ" => u"kJ", "MJ" => u"MJ",
    "W" => u"W", "kW" => u"kW", "MW" => u"MW",
    # electricidad y magnetismo
    "V" => u"V", "kV" => u"kV", "mV" => u"mV",
    "A" => u"A", "mA" => u"mA", "kA" => u"kA",
    "C" => u"C", "Ω" => u"Ω",
    # temperatura
    "K" => u"K", "°C" => u"°C", "°F" => u"°F",
    # volumen, cantidad de sustancia, ángulos, luz
    "L" => u"L", "mL" => u"mL", "mol" => u"mol", "mmol" => u"mmol",
    "rad" => u"rad", "°" => u"°", "cd" => u"cd",
    # unidades inglesas comunes
    "ft" => u"ft", "yd" => u"yd", "lb" => u"lb",
    # información (custom de este módulo: dimensión propia, no se mezclan con SI)
    # OJO: u"" NO ve unidades custom sin Unitful.register → se usan las
    # variables definidas arriba (byte muestra "B" como abbr de show)
    "bit" => bit, "byte" => byte, "B" => byte, "kB" => kB, "MB" => MB,
)

"""Quita las comillas de estilo MathLive: "'°C'" → "°C" (seguro con Unicode)."""
function strip_style_quotes(s::AbstractString)::String
    (length(s) >= 2 && startswith(s, "'") && endswith(s, "'")) ||
        return String(s)
    return String(s[nextind(s, firstindex(s)):prevind(s, lastindex(s))])
end

"""
    parse_unit(str) -> Union{Units, Quantity, Nothing}

Parser de cadenas de unidad (round-trip de `string(unit(x))`, p.ej.
`"m s^-1"`, `"km"`, `"°C"`). Devuelve `nothing` si no reconoce algo.
"""
function parse_unit(str)
    s = strip(strip_style_quotes(str))
    isempty(s) && return nothing
    s == "1" && return NoUnits
    result = nothing
    for tok in split(s, r"[\s·*]+")
        isempty(tok) && continue
        u = parse_unit_token(String(tok))
        u === nothing && return nothing
        result = result === nothing ? u : result * u
    end
    return result
end

function parse_unit_token(tok::String)
    name, exp = tok, 1
    i = findfirst('^', tok)   # findfirst(Char) devuelve Int, no UnitRange
    if i !== nothing
        name = tok[1:prevind(tok, i)]
        expstr = tok[nextind(tok, i):end]
        exp = tryparse(Int, expstr)
        exp === nothing && return nothing
    end
    name == "1" && return NoUnits
    u = get(ATOMS, name, nothing)
    u === nothing && return nothing
    try
        return exp == 1 ? u : u^exp
    catch
        return nothing
    end
end

"""
    lookup_unit(name) -> Union{Units, Nothing}

Resolución de HOJAS MathJSON: "m", "km", "'°C'"… → unidad (o `nothing`).
"""
lookup_unit(name::AbstractString) = parse_unit(name)

"""
    unit_leaf(name) -> Union{Quantity, Nothing}

Hoja MathJSON en sitio de valor: "m" → 1.0 m (la cantidad unidad-base que
multiplica en ["InvisibleOperator",5,"m"]).
"""
function unit_leaf(name::AbstractString)
    u = lookup_unit(name)
    u === nothing && return nothing
    q = 1.0 * u
    return q
end

# ── Helpers de evaluación (usados por mathjson.jl) ─────────────────────────

"""Cantidad adimensional → Float64; dimensional → UNIT_MISMATCH."""
function dimless_val(op::String, x)::Float64
    x isa Quantity || return Float64(x)
    dimension(x) != NoDims &&
        throw(MathError("UNIT_MISMATCH",
            "$op requiere un argumento adimensional (recibió $(unit(x)))"))
    return Float64(ustrip(x))
end

"""
Ángulo → radianes en Float64 (sin(90°)=1 ✓). Acepta cualquier NoDims
(los ángulos son adimensionales en Unitful) y rechaza dimensionales.
"""
function rad_arg(op::String, x)::Float64
    x isa Quantity || return Float64(x)
    dimension(x) != NoDims &&
        throw(MathError("UNIT_MISMATCH",
            "$op requiere un ángulo o número adimensional (recibió $(unit(x)))"))
    return Float64(ustrip(uconvert(u"rad", x)))
end

"""Valor de una cantidad EN SU UNIDAD (para floor/round de cantidades)."""
qvalue(x::Quantity)::Float64 = Float64(ustrip(x))

"""Redondeo manual de cantidades: floor(1.5 m) → 1.0 m (Unitful lo rechaza)."""
qround(f::Function, x::Quantity) = f(qvalue(x)) * unit(x)

"""(valor, unidad) para el JSON del resultado. NoDims/planos → unit "1"."""
function value_and_unit(x)::Tuple{Float64,String}
    x isa Quantity || return (Float64(x), "1")
    s = string(unit(x))
    isempty(s) && (s = "1")
    return (Float64(ustrip(x)), s)
end

"""Env JSON → cantidad: {value: 9.81, unit: "m"} → 9.81 m."""
function env_quantity(value, unit_str)
    v = Float64(value)
    (unit_str === nothing || unit_str == "" || unit_str == "1") && return v
    u = parse_unit(unit_str)
    u === nothing &&
        throw(MathError("UNIT_PARSE", "Unidad desconocida en el entorno: $unit_str"))
    q = v * u
    return q isa Quantity ? q : v   # NoUnits → número plano
end

"""Spec de env (número plano o {value, unit}) → Real/cantidad."""
function env_quantity_from_spec(spec)
    spec isa Real && return Float64(spec)
    if spec isa AbstractDict
        v = pget(spec, :value, nothing)
        v === nothing && throw(MathError("INVALID_ENV", "env sin campo value"))
        ustr = pget(spec, :unit, nothing)
        return env_quantity(v, ustr === nothing ? nothing : string(ustr))
    end
    throw(MathError("INVALID_ENV", "Spec de env no soportado: $(typeof(spec))"))
end

# Errores de Unitful → MathError de dominio (ver apply_op en mathjson.jl)
function unitful_to_matherror(e)::Bool
    e isa DimensionError &&
        throw(MathError("UNIT_MISMATCH", "Unidades incompatibles: " *
            sprint(showerror, e)))
    e isa AffineError &&
        throw(MathError("UNIT_AFFINE",
            "Operación inválida con unidad affine (p.ej. °C): " *
            sprint(showerror, e) * " — usa → para convertir"))
    return false
end
