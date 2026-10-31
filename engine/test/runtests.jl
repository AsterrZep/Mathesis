# Tests del engine Mathesis (Fase 0)
# Ejecutar: julia --project=engine engine/test/runtests.jl

using Test

# Incluye el módulo sin ejecutar el loop RPC (PROGRAM_FILE ≠ MathesisEngine.jl)
include(joinpath(@__DIR__, "..", "src", "MathesisEngine.jl"))
using .MathesisEngine: MathError, mj_eval, eval_cell, eval_document, plot_data,
    process_line, format_number, parse_unit, value_and_unit, export_doc
using Unitful

@testset "mj_eval — aritmética MathJSON" begin
    env = Dict{String,Float64}()
    @test mj_eval(["Add", 2, 2], env) == 4.0
    @test mj_eval(["Subtract", 10, 3], env) == 7.0
    @test mj_eval(["Negate", 5], env) == -5.0
    @test mj_eval(["Multiply", 6, 7], env) == 42.0
    @test mj_eval(["Divide", 1, 2], env) == 0.5
    @test mj_eval(["Power", 2, 10], env) == 1024.0
    @test mj_eval(["Sqrt", 2], env) ≈ sqrt(2)
    # Anidado: (x+1)·3 con x=4 → 15
    env_x = Dict("x" => 4.0)
    @test mj_eval(["Multiply", ["Add", "x", 1], 3], env_x) == 15.0
end

@testset "mj_eval — errores de dominio" begin
    env = Dict{String,Float64}()
    @test_throws MathError mj_eval(["Divide", 1, 0], env)
    @test_throws MathError mj_eval(["Sqrt", -1], env)
    @test_throws MathError mj_eval(["Add", "nope", 1], env)
    @test_throws MathError mj_eval(["Integrate", 1, 2], env)  # Fase 3
    # Códigos exactos
    try
        mj_eval(["Divide", 1, 0], env)
    catch e
        @test e isa MathError && e.code == "DIV_ZERO"
    end
end

@testset "eval_cell — contrato de resultado" begin
    params = Dict{String,Any}("cellId" => "c1", "ast" => ["Add", 2, 2], "env" => Dict())
    r = eval_cell(params)
    @test r.status == "ok"
    @test r.value == "4"
    @test r.unit == "1"
    @test r.type == "real"

    # Entorno anidado: {x: {value: 4}}
    params2 = Dict{String,Any}(
        "cellId" => "c2",
        "ast" => ["Multiply", "x", 2],
        "env" => Dict("x" => Dict("value" => 4)),
    )
    @test eval_cell(params2).value == "8"
end

@testset "format_number" begin
    @test format_number(4.0) == "4"
    @test format_number(-2.5) == "-2.5"
    @test format_number(1 / 3) == string(round(1 / 3, sigdigits = 15))
    # dígitos significativos configurables (settings.digits del documento)
    @test format_number(Float64(pi), 4) == "3.142"
    @test format_number(Float64(pi), 6) == "3.14159"
end

@testset "nodos estructurales (ce.parse canonical:false)" begin
    env = Dict{String,Float64}("x" => 4.0)
    # Delimiter transparente: 2·(x+1) → 10
    @test mj_eval(["Multiply", 2, ["Delimiter", ["Add", "x", 1]]], env) == 10.0
    # Delimiter vacío → error de dominio
    try
        mj_eval(["Delimiter"], env)
        @test false
    catch e
        @test e isa MathError && e.code == "INVALID_AST"
    end
    # InvisibleOperator (multiplicación implícita)
    @test mj_eval(["InvisibleOperator", 2, ["Delimiter", ["Add", "x", 1]]], env) == 10.0
    # 1/0 preservado → DIV_ZERO (regresión del bug "Variable: NaN")
    try
        mj_eval(["Divide", 1, 0], env)
        @test false
    catch e
        @test e isa MathError && e.code == "DIV_ZERO"
    end
    # String "NaN" (si una fuente lo emite) → NAN, no UNDEFINED_VAR
    try
        mj_eval("NaN", env)
        @test false
    catch e
        @test e isa MathError && e.code == "NAN"
    end
    # Tupla vacía (canonical:true de fallback) → paréntesis vacíos
    try
        mj_eval(["Tuple"], env)
        @test false
    catch e
        @test e isa MathError && e.code == "INVALID_AST"
    end
end

@testset "eval_document — Fase 1: variables y funciones encadenadas" begin
    doc(cells) = Dict{String,Any}("cells" => cells)
    eq(cid, ast) = Dict{String,Any}("cellId" => cid, "type" => "equation", "ast" => ast)
    ex(cid, ast) = Dict{String,Any}("cellId" => cid, "type" => "expression", "ast" => ast)
    tx(cid) = Dict{String,Any}("cellId" => cid, "type" => "text")

    # 1) cadena de variables: a=2 → b=a²+1 → b*3
    r = eval_document(doc([
        eq("c1", ["Equal", "a", 2]),
        eq("c2", ["Equal", "b", ["Add", ["Power", "a", 2], 1]]),
        ex("c3", ["Multiply", "b", 3]),
        tx("c4"),
    ]))
    vals = Dict(c.cellId => get(c, :value, nothing) for c in r.cells)
    @test vals["c1"] == "2"
    @test vals["c2"] == "5"     # 2²+1
    @test vals["c3"] == "15"    # 5·3
    @test r.cells[4].status == "ok" && r.cells[4].kind == "text"
    @test r.definitions["a"] == 2.0 && r.definitions["b"] == 5.0

    # 2) función de usuario: f(x):=x²+1 · f(3) = 10
    r2 = eval_document(doc([
        eq("f", ["Assign", "f", ["Function", ["Add", ["Power", "x", 2], 1], "x"]]),
        ex("v1", ["InvisibleOperator", "f", ["Delimiter", 3]]),
        ex("v2", ["InvisibleOperator", "f", ["Delimiter",
            ["Sequence", 1, 2], "'(,)'"]]),   # f(1,2) → arity error
    ]))
    @test r2.cells[1].status == "ok" && r2.cells[1].kind == "definition"
    @test r2.cells[2].value == "10"
    @test r2.cells[3].status == "error" && r2.cells[3].error.code == "ARITY"
    @test r2.functions == ["f"]

    # 3) error en una celda NO detiene las siguientes
    r3 = eval_document(doc([
        ex("e1", ["Divide", 1, 0]),
        eq("e2", ["Equal", "ok_var", 7]),
        ex("e3", ["Add", "ok_var", 1]),
    ]))
    @test r3.cells[1].status == "error" && r3.cells[1].error.code == "DIV_ZERO"
    @test r3.cells[2].value == "7"
    @test r3.cells[3].value == "8"

    # 4) variable no definida → error en su celda, el doc sigue
    r4 = eval_document(doc([ex("x1", ["Add", "no_existe", 1])]))
    @test r4.cells[1].status == "error" && r4.cells[1].error.code == "UNDEFINED_VAR"
end

@testset "process_line — protocolo JSON-RPC completo" begin
    # Éxito
    resp = process_line("""{"jsonrpc":"2.0","id":1,"method":"eval_cell",
        "params":{"cellId":"c","ast":["Add",2,2],"env":{}}}""")
    @test occursin("\"id\":1", resp)
    @test occursin("\"value\":\"4\"", resp)
    @test occursin("\"status\":\"ok\"", resp)

    # Error matemático → result.status=error (NO error RPC)
    resp2 = process_line("""{"jsonrpc":"2.0","id":2,"method":"eval_cell",
        "params":{"cellId":"c","ast":["Divide",1,0],"env":{}}}""")
    @test occursin("\"DIV_ZERO\"", resp2)
    @test !occursin("\"error\":{\"code\":-32", resp2)

    # Método desconocido → error RPC -32601
    resp3 = process_line("""{"jsonrpc":"2.0","id":3,"method":"nope","params":{}}""")
    @test occursin("-32601", resp3)

    # JSON inválido → error RPC -32700
    resp4 = process_line("esto no es json")
    @test occursin("-32700", resp4)

    # hello
    resp5 = process_line("""{"jsonrpc":"2.0","id":5,"method":"hello","params":{}}""")
    @test occursin("\"protocolVersion\":1", resp5)
end

@testset "mj_eval — catálogo Fase 1: trig, log, raíces, enteros" begin
    env = Dict{String,Float64}()
    # Trig completas (incluye Cot/Sec/Csc, antes no soportadas)
    @test mj_eval(["Sin", 0], env) == 0.0
    @test mj_eval(["Cos", 0], env) == 1.0
    @test mj_eval(["Tan", 0], env) == 0.0
    @test mj_eval(["Cot", pi / 4], env) ≈ 1.0
    @test mj_eval(["Sec", 0], env) ≈ 1.0
    @test mj_eval(["Csc", pi / 2], env) ≈ 1.0
    # Inversas: MathJSON emite Arccos (¡no Acos!) — regresión de nombre
    @test mj_eval(["Arccos", 1], env) == 0.0
    @test mj_eval(["Acos", 1], env) == 0.0        # alias aceptado
    @test mj_eval(["Arcsin", 0], env) == 0.0
    @test mj_eval(["Arctan", 1], env) ≈ pi / 4
    @test mj_eval(["Arcsec", 1], env) ≈ 0.0
    @test mj_eval(["Arccsc", 1], env) ≈ pi / 2
    # Hiperbólicas inversas
    @test mj_eval(["Arcsinh", 0], env) == 0.0
    @test mj_eval(["Arccosh", 1], env) ≈ 0.0
    @test mj_eval(["Arctanh", 0], env) == 0.0
    # Log: Ln natural, Log base 10, ["Log", x, base] arbitraria, Lb base 2
    @test mj_eval(["Ln", "e"], env) ≈ 1.0
    @test mj_eval(["Log", 100], env) ≈ 2.0
    @test mj_eval(["Log", 9, 3], env) ≈ 2.0       # \log_3(9) → ["Log",9,3]
    @test mj_eval(["Lb", 8], env) ≈ 3.0
    # Raíz n-ésima: par exige x ≥ 0; impar cubre todo ℝ
    @test mj_eval(["Root", 8, 3], env) ≈ 2.0
    @test mj_eval(["Root", -8, 3], env) ≈ -2.0
    @test mj_eval(["Root", 16, 4], env) ≈ 2.0
    # Redondeo y signo
    @test mj_eval(["Floor", 2.7], env) == 2.0
    @test mj_eval(["Ceil", 2.1], env) == 3.0
    @test mj_eval(["Round", 2.5], env) == 3.0     # ties away from zero
    @test mj_eval(["Sign", -3], env) == -1.0
    # Combinatoria y enteros
    @test mj_eval(["Factorial", 5], env) == 120.0
    @test mj_eval(["GCD", 12, 18], env) == 6.0
    @test mj_eval(["LCM", 4, 6], env) == 12.0
    @test mj_eval(["Mod", 7, 3], env) == 1.0
    # Mín/Máx con nombres implícitos (\min/\max)
    @test mj_eval(["Min", 2, 3], env) == 2.0
    @test mj_eval(["Max", 2, 3], env) == 3.0

    # Apply / InverseFunction: \sin^{-1}(0.5) → ["Apply",["InverseFunction","Sin"],0.5]
    @test mj_eval(["Apply", ["InverseFunction", "Sin"], 0.5], env) ≈ asin(0.5)
    @test mj_eval(["Apply", ["InverseFunction", "Cos"], 1], env) ≈ 0.0
    # Funciones con nombre vía InvisibleOperator: \exp(x), \gcd(12,18), sign
    @test mj_eval(["InvisibleOperator", "Exp", ["Delimiter", 0]], env) ≈ 1.0
    @test mj_eval(["InvisibleOperator", "GCD",
        ["Delimiter", ["Sequence", 12, 18], "'(,)'"]], env) == 6.0
    @test mj_eval(["InvisibleOperator", "sign", ["Delimiter", -2]], env) == -1.0
    # Nodos Infinity de MathLive: \infty → "PositiveInfinity"
    try
        mj_eval("PositiveInfinity", env)
        @test false
    catch e
        @test e isa MathError && e.code == "INFINITY"
    end
    # Nodo Error (LaTeX incompleto) → LATEX_INCOMPLETE, no UNDEFINED_VAR
    try
        mj_eval(["Error", "'unexpected-command'"], env)
        @test false
    catch e
        @test e isa MathError && e.code == "LATEX_INCOMPLETE"
    end

    # Errores de dominio del catálogo nuevo
    for (ast, code) in [
        (["Arcsin", 2], "DOMAIN"),
        (["Arccos", 2], "DOMAIN"),
        (["Ln", -1], "DOMAIN"),
        (["Log", -5], "DOMAIN"),
        (["Log", 8, 1], "DOMAIN"),        # base 1 inválida
        (["Root", -8, 4], "DOMAIN"),      # raíz par de negativo
        (["Factorial", -1], "DOMAIN"),   # dominio entero
        (["Factorial", 2.5], "DOMAIN"),
        (["GCD", 1.5, 2], "DOMAIN"),     # enteros requeridos
        (["Arctanh", 2], "DOMAIN"),
        (["Arccosh", 0], "DOMAIN"),
        (["Mod", 5, 0], "DIV_ZERO"),
    ]
        try
            mj_eval(ast, env)
            @test false
        catch e
            @test e isa MathError && e.code == code
        end
    end
end

@testset "eval_document — incremental (changedCellIds + caché)" begin
    doc(cells) = Dict{String,Any}("cells" => cells)
    ex(cid, ast) = Dict{String,Any}("cellId" => cid, "type" => "expression", "ast" => ast)
    tx(cid, text) = Dict{String,Any}("cellId" => cid, "type" => "text", "latex" => text)

    # Eval inicial completa (a=2 → b=a²+1 → c=b·3 + celda ajena d=7)
    cells0 = [
        ex("i_a", ["Equal", "a", 2]),
        ex("i_b", ["Equal", "b", ["Add", ["Power", "a", 2], 1]]),
        ex("i_c", ["Multiply", "b", 3]),
        ex("i_d", ["Equal", "d", 7]),
        tx("i_t", "nota"),
    ]
    r0 = eval_document(doc(cells0))
    @test r0.recomputed == "all"
    vals0 = Dict(c.cellId => get(c, :value, nothing) for c in r0.cells)
    @test vals0["i_c"] == "15"

    # 1) Cambiar solo i_a (a=3) → re-evalúa a, b, c; d y texto se replayan
    cells1 = copy(cells0); cells1[1] = ex("i_a", ["Equal", "a", 3])
    r1 = eval_document(Dict{String,Any}("cells" => cells1,
        "changedCellIds" => ["i_a"]))
    @test r1.recomputed == ["i_a", "i_b", "i_c"]
    vals1 = Dict(c.cellId => get(c, :value, nothing) for c in r1.cells)
    @test vals1["i_b"] == "10"    # 3²+1
    @test vals1["i_c"] == "30"
    @test vals1["i_d"] == "7"     # replay desde caché

    # 2) Cambiar una celda AJENA (i_d) → solo i_d
    cells2 = copy(cells1); cells2[4] = ex("i_d", ["Equal", "d", 9])
    r2 = eval_document(Dict{String,Any}("cells" => cells2,
        "changedCellIds" => ["i_d"]))
    @test r2.recomputed == ["i_d"]
    vals2 = Dict(c.cellId => get(c, :value, nothing) for c in r2.cells)
    @test vals2["i_c"] == "30"    # sin cambios
    @test vals2["i_d"] == "9"

    # 3) Rename a→q: los que usaban "a" deben re-evaluar (UNDEFINED_VAR)
    cells3 = copy(cells2); cells3[1] = ex("i_a", ["Equal", "q", 3])
    r3 = eval_document(Dict{String,Any}("cells" => cells3,
        "changedCellIds" => ["i_a"]))
    @test "i_b" in r3.recomputed
    err3 = Dict(c.cellId => get(c, :error, nothing) for c in r3.cells)
    @test err3["i_b"].code == "UNDEFINED_VAR"

    # 4) Funciones de usuario: cambiar el cuerpo de g re-evalúa a sus usuarios
    cells4 = [
        ex("i_f1", ["Assign", "g", ["Function", ["Multiply", "x", 2], "x"]]),
        ex("i_g1", ["InvisibleOperator", "g", ["Delimiter", 5]]),
    ]
    rf1 = eval_document(doc(cells4))
    @test rf1.cells[2].value == "10"
    cells5 = copy(cells4)
    cells5[1] = ex("i_f1", ["Assign", "g", ["Function", ["Multiply", "x", 3], "x"]])
    rf2 = eval_document(Dict{String,Any}("cells" => cells5,
        "changedCellIds" => ["i_f1"]))
    @test rf2.recomputed == ["i_f1", "i_g1"]
    @test rf2.cells[2].value == "15"

    # 5) settings.digits afecta al formato
    rd = eval_document(Dict{String,Any}(
        "cells" => [ex("i_pi", ["Multiply", "π", 1])],
        "settings" => Dict("digits" => 4)))
    @test rd.cells[1].value == "3.142"
end

@testset "plot_data — Fase 1: muestreo para uPlot" begin
    pl(params) = plot_data(Dict{String,Any}(String(k) => v for (k, v) in pairs(params)))

    # sin(x) sobre [-π, π] con 5 puntos: y = [0, 1, 0, -1, 0]
    r = pl(Dict{Symbol,Any}(
        :ast => ["Sin", "x"], :xFrom => -pi, :xTo => pi, :steps => 5))
    @test r.status == "ok" && length(r.x) == 5 && length(r.y) == 5
    @test r.y[1] ≈ 0.0 atol = 1e-12
    @test r.y[2] ≈ -1.0 atol = 1e-12   # sin(-π/2)
    @test r.y[4] ≈ 1.0 atol = 1e-12    # sin(π/2)
    @test r.nonFinite == 0

    # √x sobre [-1, 1]: mitad negativa → null (gap), no crash
    r2 = pl(Dict{Symbol,Any}(
        :ast => ["Sqrt", "x"], :xFrom => -1, :xTo => 1, :xStepsIgnored => 0,
        :steps => 5))
    @test r2.y[1] === nothing && r2.y[3] ≈ 0.0 && r2.y[5] ≈ 1.0
    @test r2.nonFinite == 2

    # definitions del doc viajan: a=2 → graficar a*x sobre [0,2] → [0,2,4]
    r3 = pl(Dict{Symbol,Any}(
        :ast => ["Multiply", "a", "x"], :xFrom => 0, :xTo => 2,
        :steps => 3, :env => Dict("a" => 2.0)))
    @test r3.y ≈ [0.0, 2.0, 4.0]

    # from/to invertidos se normalizan + steps se acota
    r4 = pl(Dict{Symbol,Any}(
        :ast => ["Add", "x", 0], :xFrom => 5, :xTo => -5, :steps => 100_000))
    @test r4.from == -5.0 && r4.to == 5.0 && length(r4.x) == 5000
end

@testset "unidades — Fase 2: hoja, aritmética, conversión, errores" begin
    env = Dict{String,Float64}()

    # 1) Hoja de unidad: 5\,\text{m} → ["InvisibleOperator",5,"m"] → 5.0 m
    q = mj_eval(["InvisibleOperator", 5, "m"], env)
    @test q isa Quantity && ustrip(u"m", q) == 5.0
    # 2) Prefijos, compuestos y round-trip del parser
    @test parse_unit("km") !== nothing
    @test parse_unit("m s^-1") !== nothing
    @test parse_unit("'°C'") !== nothing          # comillas MathLive
    @test parse_unit("bit") !== nothing && parse_unit("B") !== nothing
    @test parse_unit("nonesuch") === nothing
    @test value_and_unit(1.0u"km") == (1000.0 |> x -> 1.0, "km") || value_and_unit(1.0u"km") == (1.0, "km")
    vn, vu = value_and_unit(2.5u"m/s")
    @test vn == 2.5 && vu == "m s^-1"

    # 3) Aritmética con conversión automática: 1 km + 500 m → 1500 m
    r = mj_eval(["Add", ["InvisibleOperator", 1, "km"],
                        ["InvisibleOperator", 500, "m"]], env)
    @test ustrip(u"m", r) == 1500.0
    # Composición: 3 kg·m/s² (como N)
    r2 = mj_eval(["Multiply", ["Multiply", 3, "kg"],
                   ["Divide", "m", ["Power", "s", 2]]], env)
    @test ustrip(upreferred(r2)) == 3.0
    # Escalar × cantidad y división
    @test ustrip(u"m", mj_eval(["Multiply", ["InvisibleOperator", 5, "m"], 2], env)) == 10.0
    @test dimension(mj_eval(["Divide", ["InvisibleOperator", 5, "m"],
                                    ["InvisibleOperator", 2, "s"]], env)) == u"s^-1" * u"m" |> dimension

    # 4) Errores dimensionales → UNIT_MISMATCH
    for (ast, code) in [
        (["Add", ["InvisibleOperator", 1, "m"], ["InvisibleOperator", 1, "s"]], "UNIT_MISMATCH"),
        (["Sin", ["InvisibleOperator", 1, "m"]], "UNIT_MISMATCH"),
        (["Ln", ["InvisibleOperator", 2, "m"]], "UNIT_MISMATCH"),
        (["Power", 2, ["InvisibleOperator", 1, "m"]], "UNIT_MISMATCH"),
        (["Add", ["InvisibleOperator", 1, "bit"], ["InvisibleOperator", 1, "m"]], "UNIT_MISMATCH"),
    ]
        try
            mj_eval(ast, env)
            @test false
        catch e
            @test e isa MathError && e.code == code
        end
    end

    # 5) Ángulos: sin(90°) = 1 (pasa a radianes), cos(0 rad) = 1
    s = mj_eval(["Sin", ["InvisibleOperator", 90, "'°'"]], env)
    @test s ≈ 1.0 atol = 1e-12
    @test mj_eval(["Cos", ["InvisibleOperator", 0, "rad"]], env) ≈ 1.0

    # 6) Conversión →: 1 km → 1000 m (ignora el número del destino)
    conv = mj_eval(["To", ["InvisibleOperator", 1, "km"],
                          ["InvisibleOperator", 1000, "m"]], env)
    @test ustrip(u"m", conv) == 1000.0
    try
        mj_eval(["To", ["InvisibleOperator", 1, "m"],
                      ["InvisibleOperator", 1, "s"]], env)
        @test false
    catch e
        @test e isa MathError && e.code == "UNIT_MISMATCH"
    end

    # 7) °C (affine): hoja ✓ · 500 K → 226.85 °C ✓ · °C + °C → UNIT_AFFINE
    @test ustrip(u"°C", mj_eval(["InvisibleOperator", 100, "'°C'"], env)) == 100.0
    conv2 = mj_eval(["To", ["InvisibleOperator", 500, "K"],
                           ["InvisibleOperator", 1, "'°C'"]], env)
    @test ustrip(u"°C", conv2) ≈ 226.85 atol = 1e-9
    try
        mj_eval(["Add", ["InvisibleOperator", 100, "'°C'"],
                       ["InvisibleOperator", 50, "'°C'"]], env)
        @test false
    catch e
        @test e isa MathError && e.code == "UNIT_AFFINE"
    end

    # 8) Unidades de información (custom, dimensión propia)
    # OJO: u"" no ve las custom sin register → se resuelven con parse_unit
    bitu = parse_unit("bit")
    b = mj_eval(["InvisibleOperator", 8, "bit"], env)
    @test ustrip(bitu, b) == 8.0
    conv3 = mj_eval(["To", ["InvisibleOperator", 1, "kB"],
                           ["InvisibleOperator", 1, "bit"]], env)
    @test ustrip(bitu, conv3) == 8000.0
    # floor/redondeo EN SU UNIDAD (Unitful lo rechaza, lo hacemos a mano)
    fl = mj_eval(["Floor", ["InvisibleOperator", 1.5, "m"]], env)
    @test fl isa Quantity && ustrip(u"m", fl) == 1.0
    rd = mj_eval(["Round", ["InvisibleOperator", 2.5, "m"]], env)
    @test ustrip(u"m", rd) == 3.0
    # sqrt de área → longitud
    @test ustrip(u"m", mj_eval(["Sqrt", ["InvisibleOperator", 4, ["Power", "m", 2]]], env)) == 2.0
end

@testset "unidades — Fase 2: eval_cell / eval_document / plot / RPC" begin
    # eval_cell con unidad en el resultado
    r = eval_cell(Dict{String,Any}("cellId" => "u1",
        "ast" => ["InvisibleOperator", 5, "m"], "env" => Dict()))
    @test r.status == "ok" && r.value == "5" && r.unit == "m"

    # eval_cell con env {value, unit}
    r2 = eval_cell(Dict{String,Any}("cellId" => "u2",
        "ast" => ["Multiply", "a", 2],
        "env" => Dict("a" => Dict("value" => 9.81, "unit" => "m"))))
    @test r2.status == "ok" && r2.unit == "m" && parse(Float64, r2.value) ≈ 19.62

    # eval_document: definición con unidad → JSON {value, unit} + downstream
    doc = Dict{String,Any}("cells" => Any[
        Dict{String,Any}("cellId" => "d1", "type" => "expression",
            "ast" => ["Equal", "a", ["InvisibleOperator", 5, "m"]]),
        Dict{String,Any}("cellId" => "d2", "type" => "expression",
            "ast" => ["Multiply", "a", 2]),
    ])
    rd = eval_document(doc)
    @test rd.cells[1].unit == "m" && rd.cells[1].value == "5"
    @test rd.cells[1].defines["a"] == (value = 5.0, unit = "m")
    @test rd.definitions["a"] == (value = 5.0, unit = "m")
    @test rd.cells[2].unit == "m" && rd.cells[2].value == "10"

    # plot_data con env que trae unidad: y adimensional en valores de m/s²·x
    pl = plot_data(Dict{String,Any}(
        "ast" => ["Multiply", "a", "x"],
        "xFrom" => 0.0, "xTo" => 2.0, "steps" => 3, "varName" => "x",
        "env" => Dict("a" => Dict("value" => 9.81, "unit" => "m"))))
    @test pl.status == "ok" && pl.unit == "m"
    @test pl.y ≈ [0.0, 9.81, 19.62]

    # RPC end-to-end: unidades serializadas en la respuesta
    resp = process_line("""{"jsonrpc":"2.0","id":9,"method":"eval_cell","params":{
        "cellId":"u3","ast":["InvisibleOperator",2,"km"],"env":{}}}""")
    @test occursin("\"unit\":\"km\"", resp)
end

@testset "export latex — Fase 2" begin
    payload = Dict{String,Any}("kind" => "latex", "doc" => Dict{String,Any}(
        "title" => "Mi doc_100%",
        "cells" => Any[
            Dict{String,Any}("cellId" => "e1", "type" => "expression",
                "latex" => "a=2", "ast" => ["Equal", "a", 2]),
            Dict{String,Any}("cellId" => "e2", "type" => "expression",
                "latex" => "b\\cdot 3", "ast" => ["Multiply", "b", 3]),
            Dict{String,Any}("cellId" => "e3", "type" => "expression",
                "latex" => "5\\,\\text{m}", "ast" => ["InvisibleOperator", 5, "m"]),
            Dict{String,Any}("cellId" => "e4", "type" => "expression",
                "latex" => "f(2)", "ast" => ["InvisibleOperator", "f", ["Delimiter", 2]]),
            Dict{String,Any}("cellId" => "t1", "type" => "text",
                "latex" => "Nota: 100% & se dibuja"),
            Dict{String,Any}("cellId" => "im1", "type" => "image",
                "latex" => "", "assetId" => "a1"),
            Dict{String,Any}("cellId" => "p1", "type" => "plot", "latex" => ""),
        ]))
    r = export_doc(payload)
    @test r.status == "ok" && r.mime == "application/x-latex"
    @test endswith(r.content, "\\end{document}\n")
    # Imagen → comentario (no rompe el .tex); plot/interval → fuera
    @test occursin("% [imagen: no representada en LaTeX", r.content)
    @test !occursin("sin(x)", r.content)
    # Preámbulo + título escapado (underscore y % son peligrosos en LaTeX)
    @test occursin("\\documentclass[11pt]{article}", r.content)
    @test occursin("\\title{Mi doc\\_100\\%}", r.content)
    # Definición a=2: NO se duplica el resultado
    @test occursin("\\[ a=2 \\]", r.content)
    # Celda con error → marcador inline con código (underscore escapado)
    @test occursin("b\\cdot 3 \\qquad \\text{(error: UNDEFINED\\_VAR)}", r.content)
    # Expresión con unidad → resultado de JULIA con unidad en mathrm
    @test occursin("5\\,\\text{m} = 5 \\,\\mathrm{m}", r.content)
    # f(2) sin definición → error marcado (no rompe el doc)
    @test occursin("\\text{(error: UNDEFINED\\_VAR)}", r.content)
    # Texto escapado
    @test occursin("Nota: 100\\% \\& se dibuja", r.content)
    # kind inexistente → UNSUPPORTED
    try
        export_doc(Dict{String,Any}("kind" => "png", "doc" => Dict("cells" => [])))
        @test false
    catch e
        @test e isa MathError && e.code == "UNSUPPORTED"
    end
end
