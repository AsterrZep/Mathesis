# MCPs, herramientas y skills para el proyecto

> Investigado el 30 oct 2026. **Estado: MCPs configurados y skills instaladas** ✅

## ✅ MCPs CONFIGURADOS (globales, en `~/.config/opencode/opencode.json`)

| MCP | Tipo | Estado | Uso en el proyecto |
|---|---|---|---|
| **context7** | remote (`https://mcp.context7.com/mcp`) | ✅ **Conectado y probado** | Docs actualizadas de Tauri/Symbolics/React en contexto del agente. Resolvió `/tauri-apps/tauri-docs` al instante |
| **github** | local (`npx @modelcontextprotocol/server-github`) | ⚠️ Configurado — **requiere exportar `GITHUB_TOKEN`** | Gestionar issues, PRs, releases del repo Mathesis |

### ⚠️ Pendiente: token de GitHub

El MCP de GitHub usa `{env:GITHUB_TOKEN}` (el token NUNCA se escribe en la
config). Para activarlo, añade a tu shell (`~/.zshrc`, `~/.bashrc` o `config.fish`):

```bash
export GITHUB_TOKEN="$(gh auth token)"
```

(`gh` ya está autenticado como **AsterrZep** — solo falta exportar la variable.
En fish: `set -gx GITHUB_TOKEN (gh auth token)`.)

> Nota: `opencode mcp list` (CLI 1.18.18) muestra un falso error de schema —
> el **servicio** (que es lo que usa los MCPs) los carga correctamente. Se
> verifica con `/mcps` en el TUI o probando una herramienta.

### Config actual (`~/.config/opencode/opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "mcp": {
    "servers": {
      "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
      "github": {
        "type": "local",
        "command": ["npx", "-y", "@modelcontextprotocol/server-github"],
        "environment": { "GITHUB_TOKEN": "{env:GITHUB_TOKEN}" }
      }
    }
  }
}
```

## ✅ SKILLS INSTALADAS

### Skills del proyecto (creadas a medida) — `.opencode/skills/`

| Skill ID | Cuándo se carga |
|---|---|
| `mathesis-architecture` | Siempre que se trabaje en Mathesis — decisiones de stack, ADRs, dónde vive cada doc |
| `julia-engine` | Al tocar `engine/` (RPC loop, MathJSON→Symbolics, DocumentEnv, PackageCompiler) |
| `tauri-sidecar` | Al configurar el sidecar (externalBin, capabilities, watchdog, bundling) |
| `mathlive-worksheet` | Al construir la UI (MathLive, MathJSON, Zustand, uPlot, ciclo debounce) |

### Skills del ecosistema (instaladas con `npx skills`) — `.agents/skills/`

Instaladas con el CLI oficial de Vercel Labs (`npx skills`, compatible con
OpenCode). Todas verificadas por popularidad + relevancia para Mathesis:

| Skill | Fuente | Installs | Relevancia |
|---|---|---|---|
| `tauri-v2` | nodnarbnitram/claude-code-extensions | 8.1K | ⭐ Config de tauri.conf.json, comandos `#[tauri::command]`, capabilities, errores comunes |
| `tauri-ipc` | full-stack-skills/tauri-skills | 549 | ⭐ Patrones IPC invoke/emit/canales — directamente nuestro puente al sidecar |
| `rust-best-practices` | apollographql/skills | 21.8K | Convenciones Rust para el núcleo Tauri |
| `rust-async-patterns` | wshobson/agents | 21.3K | Async/await para el cliente RPC del sidecar (tokio, oneshot) |
| `zustand` | lobehub/lobehub | 6.9K | Store del documento (stack elegido) |
| `vitest` | antfu/skills | 45.1K | Testing del frontend (stack elegido) |

**Descubrimiento de skills de Julia: NO existen en el registro** (la búsqueda
devolvió skills de diseño irrelevantes). Nuestra `julia-engine` custom cubre ese
hueco — el ecosistema Julia es nicho para este tipo de skills.

### Cómo buscar e instalar más (CLI `npx skills`)

```bash
cd /home/aster/Projects/Mathesis
npx skills find <tema>              # buscar (ej: npx skills find webgl)
npx skills add owner/repo@skill -a opencode -y   # instalar para OpenCode
npx skills list                     # inventario instalado
npx skills check                    # buscar actualizaciones
npx skills update                   # actualizar
npx skills remove <skill>           # desinstalar
```

- Registry: https://skills.sh (leaderboard con installs, audits de seguridad)
- Las skills se copian a `.agents/skills/` (OpenCode las descubre como
  compatibility path); `skills-lock.json` guarda las fuentes para updates
- Desactivar telemetría: `DISABLE_TELEMETRY=1`

## 🛠️ Herramientas CLI del entorno

### Instaladas ✅

| Herramienta | Versión | Uso |
|---|---|---|
| julia (juliaup) | 1.12.6 | Motor matemático |
| rustc / cargo | 1.97.1 | Núcleo Tauri |
| node | 26.2.0 | Frontend + `npx skills` + MCPs |
| pnpm | — | Paquetes frontend |
| gh CLI | — | Autenticado como AsterrZep (para MCP github) |

### Por instalar (fase 0)

| Herramienta | Instalación | Uso |
|---|---|---|
| cargo-tauri | `cargo install tauri-cli` | Dev/build de la app |
| just | `pacman -S just` | Runner de tareas |
| jq | `pacman -S jq` | Depurar JSON del IPC |

### Linting / formato

| Capa | Herramienta |
|---|---|
| Rust | `cargo fmt` + `cargo clippy -D warnings` |
| TypeScript | ESLint (o Biome) + Prettier |
| Julia | JuliaFormatter (BlueStyle) |

## 📋 CI/CD (GitHub Actions, fase 0+)

| Paso | Acción |
|---|---|
| Build frontend | `pnpm build` |
| Test Rust | `cargo test`, `cargo clippy` |
| Test Julia | `julia --project=engine -e 'using Pkg; Pkg.test()'` |
| Build app | `tauri-apps/tauri-action@v0` (matrix: ubuntu/windows/macos) |
| Sysimage Julia | Build por target + `actions/cache` (~20 min 1ª vez) |

## 📦 MCP futuro del producto (fase 4)

**ModelContextProtocol.jl** ([repo](https://github.com/JuliaSMLM/ModelContextProtocol.jl))
— exponer el motor de Mathesis como servidor MCP para que asistentes IA
(Claude, Cursor…) usen `simplify`, `solve`, `plot_data` como herramientas.
"Mathesis como backend matemático para LLMs".

## 📚 Referencias de implementación a estudiar

| Proyecto | Qué aporta |
|---|---|
| [microMathematics](https://github.com/mkulesh/microMathematics) | Modelo de features y formato (GPL — no copiar código) |
| [MathLive](https://mathlive.io) | Editor 2D + MathJSON (Apache-2.0) |
| [Makie.jl](https://docs.makie.org) | CairoMakie para export (MIT) |
| [Tauri docs](https://v2.tauri.app) | Sidecar, capabilities, plugins |
| [Symbolics.jl](https://github.com/JuliaSymbolics/Symbolics.jl) | CAS |
| [skills.sh](https://skills.sh) | Registry de agent skills |
