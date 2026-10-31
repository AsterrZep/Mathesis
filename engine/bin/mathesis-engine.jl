#!/usr/bin/env julia
# Entry point del binario empaquetado (PackageCompiler.create_app).
# Tauri lo spawnea como sidecar: JSON-RPC NDJSON sobre stdin/stdout.
# Ver tools/build-engine-app.jl y .github/workflows/release.yml

using MathesisEngine
MathesisEngine.main()
