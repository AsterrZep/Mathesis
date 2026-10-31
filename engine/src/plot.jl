# plot.jl — datos de gráficos para el frontend (Fase 1: uPlot)
#
# Julia muestrea la función (x libre) y devuelve arrays listos para canvas.
# Zoom/pan son locales al frontend (ADR-003): idas a Julia solo al replotear.
#
# Contrato (protocolo-ipc.md):
#   params: { ast, xFrom, xTo, steps, varName?, env? (definitions del doc) }
#   result: { status:"ok", x:[…], y:[…null], nonFinite, from, to }
#   `null` en y = gap (dominio inválido p.ej. √x para x<0) → uPlot lo salta.

function plot_data(params)
    ast = pget(params, :ast, nothing)
    ast === nothing && throw(MathError("INVALID_AST", "Falta el AST a graficar"))

    from = Float64(pget(params, :xFrom, -10.0))
    to   = Float64(pget(params, :xTo, 10.0))
    to <= from && ((from, to) = (to, from))
    steps = clamp(Int(pget(params, :steps, 500)), 2, 5000)
    varname = string(pget(params, :varName, "x"))

    # Definitions del documento (Fase 2: pueden traer {value, unit})
    basevars = Dict{String,Any}()
    envobj = pget(params, :env, nothing)
    if envobj isa AbstractDict
        for (k, v) in pairs(envobj)
            basevars[string(k)] = env_quantity_from_spec(v)
        end
    end

    x = collect(range(from, to; length = steps))

    # Muestreo: las cantidades se guardan tal cual (JSON no las admite → se
    # unifican abajo); error de dominio/undefined → gap.
    raw = Vector{Any}(undef, steps)
    for (i, t) in enumerate(x)
        ctxvars = copy(basevars)
        ctxvars[varname] = t
        raw[i] = try
            mj_eval(ast, EvalCtx(ctxvars))
        catch
            nothing   # dominio inválido / undefined → gap en el trazo
        end
    end

    # Unidad de referencia = unidad de la PRIMERA muestra con unidad; el
    # resto se convierte a ella (mismatch dimensional → gap).
    ref = nothing
    for v in raw
        v isa Quantity && (ref = unit(v); break)
    end

    y = Vector{Any}(undef, steps)
    nonfinite = 0
    for (i, v) in enumerate(raw)
        num = nothing
        if v isa Quantity && ref !== nothing
            vv = try
                uconvert(ref, v)
            catch
                nothing   # unidad incompatible → gap
            end
            vv !== nothing && (num = ustrip(vv))
        elseif v isa Real
            num = Float64(v isa Quantity ? ustrip(v) : v)
        end
        if num === nothing || !isfinite(num)
            y[i] = nothing   # null JSON → gap de uPlot
            nonfinite += 1
        else
            y[i] = num
        end
    end

    return (status = "ok", x = x, y = y,
            nonFinite = nonfinite, from = from, to = to,
            unit = ref === nothing ? "1" : something(string(ref), "1"))
end
