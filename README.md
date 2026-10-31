# Mathesis 🧮

**Super calculadora matemática multiplataforma** — hoja de cálculo tipo MathCAD
con fórmulas 2D evaluadas en vivo. Reimplementación evolutiva de
[microMathematics](https://github.com/mkulesh/microMathematics) (GPL-3.0),
construida con **Tauri 2 + Rust + React + Julia**.

> 📐 Documentación completa en [`Documentacion/`](Documentacion/README.md) —
> arquitectura, ADRs, protocolo IPC, matriz de 56 capacidades y roadmap.

## Stack

| Capa | Tecnología |
|---|---|
| UI (worksheet, editor 2D) | React 19 + TypeScript + **MathLive** |
| Núcleo (ventana, IPC, sidecar) | Tauri 2 + Rust |
| Motor matemático | **Julia** (Symbolics, Unitful, FFTW, CairoMakie) — proceso sidecar |
| Protocolo | JSON-RPC 2.0 NDJSON sobre stdio |
| Formato de documento | JSON propio con AST en MathJSON |

## Desarrollo (Fase 0)

Requisitos: [Rust](https://rustup.rs), [Julia (juliaup)](https://julialang.org),
[Node + pnpm](https://pnpm.io).

```bash
pnpm install          # dependencias frontend
pnpm test             # tests del mock engine (vitest, sin Julia)
pnpm tauri dev        # app completa: Vite + Rust + sidecar Julia
```

Tests del engine Julia:

```bash
julia --project=engine engine/test/runtests.jl
```

Prueba manual del sidecar (JSON-RPC por stdin/stdout):

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"eval_cell","params":{"cellId":"c1","ast":["Add",2,2],"env":{}}}' \
  | ./src-tauri/binaries/mathesis-engine-x86_64-unknown-linux-gnu
```

## Estructura

```
Mathesis/
├── src/            React + TypeScript (worksheet, MathLive, uPlot)
├── src-tauri/      Rust (comandos, cliente RPC, sidecar)
│   └── binaries/   Wrapper dev del engine Julia (release: PackageCompiler)
├── engine/         Julia (RPC loop, MathJSON → Symbolics, cálculo)
└── Documentacion/  Toda la investigación y el diseño
```

## Estado

🚧 **Fase 0** (cimientos): `2+2=4` de punta a punta React → Rust → Julia ✅
Siguiente: Fase 1 (MVP) — ver [`Documentacion/04-plan/fases.md`](Documentacion/04-plan/fases.md).

## Licencia

**[GNU GPL-3.0](LICENSE)** — decisión del proyecto (30-oct-2026, ADR-006).
Sin código copiado del original (reimplementación limpia desde cero), la GPL es
una elección voluntaria alineada con microMathematics.
