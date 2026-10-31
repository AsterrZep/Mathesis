# build-engine-app.jl — construye el sidecar Julia RELOCATABLE (Fase 1 CI,
# Fase 4 release): PackageCompiler.create_app → carpeta self-contained con
# bin/mathesis-engine[.exe] (sin necesitar Julia instalada en el equipo final).
#
# Uso:
#   julia --project=tools -e 'using Pkg; Pkg.instantiate()'
#   julia --project=tools tools/build-engine-app.jl [destino]
#
# Destino por defecto: src-tauri/engine-runtime (tauri.conf.json lo empaqueta
# como resource y engine.rs lo spawnea en release; en dev se usa el wrapper).

using PackageCompiler

const REPO = dirname(@__DIR__)
const DEST = length(ARGS) >= 1 ? ARGS[1] : joinpath(REPO, "src-tauri", "engine-runtime")

@info "Compilando MathesisEngine → $DEST (esto tarda ~10-40 min la primera vez)"
create_app(
    joinpath(REPO, "engine"),
    DEST;
    precompile_execution_file = joinpath(REPO, "tools", "precompile-workload.jl"),
    incremental = false,
    force = true,
)

# create_app genera el executable con el nombre del PAQUETE (MathesisEngine,
# llamando a julia_main); lo renombramos al nombre del sidecar de Tauri.
const SUFFIX = Sys.iswindows() ? ".exe" : ""
const BIN = joinpath(DEST, "bin")
mv(joinpath(BIN, "MathesisEngine" * SUFFIX),
   joinpath(BIN, "mathesis-engine" * SUFFIX); force = true)

# Strip de símbolos de debug (Linux): el .deb bajaba de ~1.17 GB instalados;
# libLLVM/libjulia-codegen traen debug info enorme. M-5 en 04-plan/fases.md.
if Sys.islinux()
    stripped = 0
    fallidos = 0
    for (root, _, files) in walkdir(DEST), f in files
        path = joinpath(root, f)
        isfile(path) || continue
        is_elf = try
            open(io -> read(io, UInt32), path, read = true) == 0x464c457f
        catch
            false
        end
        is_elf || continue
        try
            run(`strip --strip-unneeded $path`)
            stripped += 1
        catch e
            fallidos += 1
            @warn "strip falló (se conserva el binario)" path exception = e
        end
    end
    @info "Strip completado" archivos = stripped fallidos
end

@info "Engine compilado" exe = joinpath(BIN, "mathesis-engine" * SUFFIX)
