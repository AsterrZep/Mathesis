fn main() {
    // Triple del target: nombra el binario del sidecar
    // (binaries/mathesis-engine-<triple> en dev, compilado por CI en release)
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=MATHESIS_HOST_TRIPLE={target}");

    // bundle.resources apunta a engine-runtime/** (el app de PackageCompiler
    // generado por tools/build-engine-app.jl en release). En dev/fresh-clone
    // ese directorio no existe (o queda vacío) y tauri-build aborta con
    // "glob pattern engine-runtime/** didn't match" → garantizamos UN archivo
    // (el .gitkeep, ignorado por git) para que el glob case siempre.
    // El build de release real puebla el directorio antes de `tauri build`.
    let runtime_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("engine-runtime");
    let marker = runtime_dir.join(".gitkeep");
    if !marker.exists() {
        if let Err(e) = std::fs::create_dir_all(&runtime_dir) {
            panic!("no se pudo crear engine-runtime: {e}");
        }
        if let Err(e) = std::fs::write(&marker, "") {
            panic!("no se pudo crear engine-runtime/.gitkeep: {e}");
        }
        println!(
            "cargo:warning=engine-runtime/.gitkeep placeholder creado \
             (el release lo puebla tools/build-engine-app.jl)"
        );
    }

    tauri_build::build()
}
