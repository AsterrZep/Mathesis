# export.jl — Exportación del documento (Fase 2)
#
# kind="latex": recorre el doc y produce un .tex compilable.
#   - texto   → párrafo escapado (\, %, &, …)
#   - fórmula → \[ LaTeX de MathLive \] + resultado evaluado por JULIA
#     (el engine es quien tiene los resultados — autoridad matemática)
#
# El frontend manda las celdas CON ast (parseo canonical:false) + latex.
# Contrato: Documentacion/02-arquitectura/protocolo-ipc.md → método "export".

"""Escapado para TEXTO plano (celdas de texto y títulos). Backslash primero."""
function escape_text(s::AbstractString)::String
    r = replace(String(s), "\\" => "\\textbackslash{}")
    for (from, to) in ("{" => "\\{", "}" => "\\}", "\$" => "\\\$",
                       "&" => "\\&", "#" => "\\#", "%" => "\\%",
                       "_" => "\\_", "^" => "\\textasciicircum{}",
                       "~" => "\\textasciitilde{}")
        r = replace(r, from => to)
    end
    return r
end

"""Unidad → TEXTO math: "m s^-1" → \\mathrm{m\\,s^{-1}}."""
function latex_unit(u::AbstractString)::String
    r = replace(String(u), r"\^(-?\d+)" => s"^{\1}")
    r = replace(r, " " => "\\,")
    r = replace(r, "_" => "\\_")   # _ rompe LaTeX incluso dentro de \text
    return "\\mathrm{" * r * "}"
end

function export_doc(params)
    kind = string(pget(params, :kind, "latex"))
    kind == "latex" ||
        throw(MathError("UNSUPPORTED", "Export no soportado aún: $kind (solo latex en Fase 2)"))
    doc = pget(params, :doc, nothing)
    doc === nothing && throw(MathError("INVALID_DOC", "Falta doc"))
    cells = pget(doc, :cells, nothing)
    cells === nothing && throw(MathError("INVALID_DOC", "Falta doc.cells"))
    title = string(pget(doc, :title, "Mathesis"))

    # Solo celdas evaluables (text/expr) — el resto se renderiza aparte
    is_eval_type(t) = t in ("text", "expression", "equation", "math")
    eval_cells = Any[]
    for c in cells
        is_eval_type(string(pget(c, :type, "expression"))) && push!(eval_cells, c)
    end

    # Resultados reales (Julia): evalúa el doc en orden con sus ast
    edoc = eval_document(Dict{String,Any}("cells" => eval_cells))

    lines = String[
        "\\documentclass[11pt]{article}",
        "\\usepackage[margin=2cm]{geometry}",
        "\\usepackage{amsmath,amssymb}",
        "\\title{" * escape_text(title) * "}",
        "\\date{}",
        "\\begin{document}",
        "\\maketitle",
    ]

    # Iterador de resultados alineado con eval_cells; se recorre el doc
    # COMPLETO para dejar comentario de las imágenes y saltar plot/interval
    results = Iterators.Stateful(edoc.cells)
    for c in cells
        ctype = string(pget(c, :type, "expression"))
        if ctype == "image"
            push!(lines, "% [imagen: no representada en LaTeX — extraer de doc.assets]")
            continue
        end
        is_eval_type(ctype) || continue   # plot/interval → fuera
        res = popfirst!(results)
        latex = string(pget(c, :latex, ""))
        if ctype == "text"
            isempty(strip(latex)) && continue
            push!(lines, escape_text(replace(latex, "\n" => " ")))
            push!(lines, "")
            continue
        end
        isempty(strip(latex)) && continue

        buf = IOBuffer()
        print(buf, "\\[ ", latex)
        # Resultado añadido salvo en DEFINICIONES: a=2 ya lo muestra el latex
        # (res trae `defines`) y f(x):=… no tiene valor numérico (kind)
        kindres = get(res, :kind, nothing)
        isdef = haskey(res, :defines) || kindres == "definition"
        if res.status == "ok" && !isdef && haskey(res, :value)
            print(buf, " = ", res.value)
            u = get(res, :unit, "1")
            (u !== nothing && u != "1") && print(buf, " \\,", latex_unit(string(u)))
        elseif res.status == "error"
            code = get(res, :error, nothing)
            cstr = code === nothing ? "" : replace(string(get(code, :code, "?")), "_" => "\\_")
            print(buf, " \\qquad \\text{(error", isempty(cstr) ? "" : ": " * cstr, ")}")
        end
        println(buf, " \\]")
        push!(lines, String(take!(buf)))
        push!(lines, "")
    end
    push!(lines, "\\end{document}")

    fn = replace(title, r"[^\w.\-]" => "_") * ".tex"
    return (status = "ok",
            content = join(lines, "\n") * "\n",
            mime = "application/x-latex",
            filename = fn)
end
