# precompile-workload.jl — carga de trabajo para el sysimage del engine.
# Se ejecuta DURANTE create_app: entrena el JIT con los caminos calientes
# del RPC (mismas llamadas que engine/test/runtests.jl, sin el harness).

using MathesisEngine

const ME = MathesisEngine

# hello + ping
ME.process_line("""{"jsonrpc":"2.0","id":1,"method":"hello","params":{}}""")
ME.process_line("""{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}""")

# eval_cell: aritmética, trig y errores de dominio
for ast in ("[\"Add\",2,2]", "[\"Sin\",\"x\"]", "[\"Divide\",1,0]", "[\"Root\",-8,3]")
    ME.process_line("""{"jsonrpc":"2.0","id":3,"method":"eval_cell","params":{
        "cellId":"c","ast":$ast,"env":{"x":{"value":0.5}}}}""")
end

# eval_document: variables encadenadas + incremental
ME.process_line("""{"jsonrpc":"2.0","id":4,"method":"eval_document","params":{"cells":[
    {"cellId":"a","type":"expression","ast":["Equal","a",2]},
    {"cellId":"b","type":"expression","ast":["Assign","f",["Function",["Sin","x"],"x"]]},
    {"cellId":"c","type":"expression","ast":["Multiply","a",3]}]}}""")
ME.process_line("""{"jsonrpc":"2.0","id":5,"method":"eval_document","params":{
    "cells":[{"cellId":"a","type":"expression","ast":["Equal","a",3]},
             {"cellId":"c","type":"expression","ast":["Multiply","a",3]}],
    "changedCellIds":["a"],"settings":{"digits":6}}}""")

# plot_data: muestreo con gaps
ME.process_line("""{"jsonrpc":"2.0","id":6,"method":"plot_data","params":{
    "ast":["Sqrt","x"],"xFrom":-1,"xTo":1,"steps":50,"varName":"x","env":{}}}""")
