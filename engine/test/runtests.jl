# Tests del engine Mathesis (Fase 0)
# Ejecutar: julia --project=engine engine/test/runtests.jl

using Test

# Incluye el módulo sin ejecutar el loop RPC (PROGRAM_FILE ≠ MathesisEngine.jl)
include(joinpath(@__DIR__, "..", "src", "MathesisEngine.jl"))
using .MathesisEngine: MathError, mj_eval, eval_cell, process_line, format_number

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
