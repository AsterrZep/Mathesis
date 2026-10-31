# Tests del engine Mathesis (Fase 0)
# Ejecutar: julia --project=engine engine/test/runtests.jl

using Test

# Incluye el módulo sin ejecutar el loop RPC (PROGRAM_FILE ≠ MathesisEngine.jl)
include(joinpath(@__DIR__, "..", "src", "MathesisEngine.jl"))
using .MathesisEngine: MathError, mj_eval, eval_cell, eval_document, process_line, format_number

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
    @test format_number(1 / 3) == string(1 / 3)
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
