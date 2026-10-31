# MathesisEngine.jl — motor matemático de Mathesis (sidecar)
#
# Protocolo: JSON-RPC 2.0 NDJSON sobre stdout/stdin.
#   - stdout SOLO lleva mensajes de protocolo (un JSON por línea).
#   - Todo log va a stderr (un println normal en stdout corrompe el RPC).
#
# Spec completa: Documentacion/02-arquitectura/protocolo-ipc.md

module MathesisEngine

using JSON3

const PROTOCOL_VERSION = 1
const ENGINE_VERSION = "0.1.0"

# Error de dominio matemático: NO es error RPC, va dentro de result.status="error"
struct MathError <: Exception
    code::String
    message::String
end
Base.showerror(io::IO, e::MathError) = print(io, e.code, ": ", e.message)

# Error de protocolo (método desconocido, params inválidos) → error RPC
struct RpcError <: Exception
    code::Int
    message::String
end
Base.showerror(io::IO, e::RpcError) = print(io, "RPC ", e.code, ": ", e.message)

include("mathjson.jl")
include("eval.jl")

# Acceso robusto a params: JSON3.Object acepta símbolos, Dict{String,Any}
# acepta strings (tests y envíos manuales) — probamos ambos.
function pget(params, key::Symbol, default = nothing)
    if params isa AbstractDict
        haskey(params, key) && return params[key]
        ks = String(key)
        haskey(params, ks) && return params[ks]
    end
    return default
end

# ---------- Dispatch de métodos ----------

function handle_method(method::AbstractString, params)
    if method == "hello"
        return (protocolVersion = PROTOCOL_VERSION,
                engineVersion = ENGINE_VERSION,
                julia = string(VERSION))
    elseif method == "ping"
        return (pong = true,)
    elseif method == "eval_cell"
        return eval_cell(params)
    elseif method == "shutdown"
        # El loop principal sale al cerrar stdin; confirmamos limpiamente
        return (ok = true,)
    else
        throw(RpcError(-32601, "Método desconocido: $method"))
    end
end

# ---------- Loop RPC (NDJSON sobre stdin/stdout) ----------

function process_line(line::AbstractString)::String
    local req
    try
        req = JSON3.read(line)
    catch
        return JSON3.write((jsonrpc = "2.0", id = nothing,
                            error = (code = -32700, message = "JSON inválido")))
    end

    id = get(req, :id, nothing)
    method = get(req, :method, nothing)
    params = get(req, :params, ())

    if method === nothing
        return JSON3.write((jsonrpc = "2.0", id = id,
                            error = (code = -32600, message = "Petición sin method")))
    end

    try
        result = handle_method(String(method), params)
        return JSON3.write((jsonrpc = "2.0", id = id, result = result))
    catch e
        if e isa MathError
            # Error matemático → dentro de result (la UI lo pinta en la celda)
            return JSON3.write((jsonrpc = "2.0", id = id,
                                result = (status = "error",
                                          error = (code = e.code, message = e.message,
                                                   cellId = pget(params, :cellId, nothing)))))
        elseif e isa RpcError
            return JSON3.write((jsonrpc = "2.0", id = id,
                                error = (code = e.code, message = e.message)))
        else
            msg = sprint(showerror, e)
            println(stderr, "[engine] error interno: ", msg)
            return JSON3.write((jsonrpc = "2.0", id = id,
                                error = (code = -32000, message = msg)))
        end
    end
end

function main()
    println(stderr, "[engine] Mathesis engine $(ENGINE_VERSION) · Julia $(VERSION)")
    # Handshake proactivo hacia Rust (notificación, sin id)
    println(stdout, JSON3.write((jsonrpc = "2.0", method = "ready",
                                 params = (engineVersion = ENGINE_VERSION,))))
    flush(stdout)

    for line in eachline(stdin)
        isempty(strip(line)) && continue
        println(stdout, process_line(line))
        flush(stdout)
    end
    println(stderr, "[engine] stdin cerrado → terminando")
end

# Solo ejecuta el loop si se invoca como script (no al hacer include en tests)
if abspath(PROGRAM_FILE) == @__FILE__
    main()
end

end # module
