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

    # Definitions del documento (para graficar p.ej. sin(a*t) con a definida)
    basevars = Dict{String,Float64}()
    envobj = pget(params, :env, nothing)
    if envobj isa AbstractDict
        for (k, v) in pairs(envobj)
            v isa Real && (basevars[string(k)] = Float64(v))
        end
    end

    x = collect(range(from, to; length = steps))
    y = Vector{Any}(undef, steps)
    nonfinite = 0
    for (i, t) in enumerate(x)
        ctxvars = copy(basevars)
        ctxvars[varname] = t
        v = try
            mj_eval(ast, EvalCtx(ctxvars))
        catch
            NaN   # dominio inválido / undefined → gap en el trazo
        end
        if isfinite(v)
            y[i] = v
        else
            y[i] = nothing   # null JSON → gap de uPlot
            nonfinite += 1
        end
    end

    return (status = "ok", x = x, y = y,
            nonFinite = nonfinite, from = from, to = to)
end
