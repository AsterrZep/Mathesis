# Roles de cada lenguaje: Rust, TypeScript y Julia

> Respondiendo a la pregunta clave: **¿qué hace cada lenguaje y cómo logramos
> máxima eficiencia y ligereza?**

## Resumen ejecutivo

| Lenguaje | Rol | % del código aprox. | ¿Por qué? |
|---|---|---|---|
| **TypeScript (React)** | UI: editor 2D, worksheet, gráficos interactivos, tema | ~50% | Es donde vive la interacción (60 fps, latencia 0) |
| **Rust (Tauri)** | Núcleo: orquestación, IPC, persistencia, sidecar, seguridad | ~15% | Binario pequeño (~5 MB), arranque instantáneo, sin runtime |
| **Julia** | Motor matemático: simbólico, unidades, numérico, FFT, export | ~35% | CAS moderno gratuito, precisión arbitraria, unidades nativas |

**Regla de oro: cada lenguaje hace lo que mejor le sale.**

- La **interacción** (dibujar a 60 fps, responder a teclas) → TypeScript/webview
- La **orquestación y sistema** (procesos, archivos, seguridad) → Rust
- La **matemática** (simplificar, integrar, convertir unidades) → Julia

## ¿Por qué NO hacer la matemática en Rust?

Existen crates de CAS en Rust (como `nalgebra`, `symbolic`…), pero:

1. **Ninguno llega al nivel de Symbolics.jl** — Symbolics es un CAS completo
   (simplificación, diferenciación, sustitución, aritmética de polinomios)
   mantenido por la comunidad SciML con años de madurez.
2. **Unidades**: `Unitful.jl` resuelve dimensionalidad completa con
   promoción automática y conversión — en Rust la opción madura (`uom`) existe
   pero la combinación con un CAS no está probada juntas.
3. **Duplicación de esfuerzo** — implementar parser + simplificador + unidades
   en Rust duplicaría todo el trabajo matemático.
4. **Julia crece con el proyecto** — si mañana quieres solucionadores ODE
   (`DifferentialEquations.jl` — el mejor del mundo), álgebra lineal
   simbólica, o machine learning, Julia ya lo tiene. En Rust lo tendrías que
   escribir.

**Conclusión**: Rust es el *gerente*, Julia es el *matemático*. Rust nunca toca
números complejos; Julia nunca toca el filesystem.

## ¿Por qué NO la UI en Julia?

Julia tiene Makie (GUI interactiva), pero:

1. **Makie como app de escritorio** = app en Julia entera → arranque de ~10 s,
   binario enorme, sin el look&feel nativo del escritorio.
2. **Tauri nos da gratis**: ventana nativa, menús, system tray, diálogos de
   archivo nativos, auto-actualizador, instalador multiplataforma, app < 10 MB.
3. **React + MathLive** — MathLive es el mejor editor matemático web que existe
   (web component con soporte de LaTeX, IME, a11y, táctil). No hay equivalente
   en Julia.
4. **Web technology** = renderer de UI de 60 fps con GPU (WebGL) gratis.

**Conclusión**: la UI en la webview de Tauri es la opción más eficiente para
una app interactiva con editor 2D.

## Por qué Julia en un proceso SEPARADO (sidecar)

| Alternativa | Pros | Contras | Veredicto |
|---|---|---|---|
| Julia embebida en Rust (`jlrs`) | Sin IPC, latencia mínima | Arranque de Julia en cada app; inestabilidad potencial (GC de Julia vs proceso Rust); jlrs menos maduro; complejidad de build brutal | ❌ |
| Julia como proceso sidecar | Aislamiento total (crash ≠ app muere), testable desde terminal, actualizable independiente, sysimage propio | Overhead de serialización (~µs–ms por llamada) | ✅ **Elegido** |
| Julia vía HTTP/WebSocket local | Desacoplado completo | Abre puerto local (riesgo de seguridad), más latencia, más complejo | ❌ innecesario |

El overhead de IPC es **despreciable** comparado con el tiempo de cómputo
matemático (una simplificación simbólica toma ms–s; serializar un JSON toma µs).
Y para **gráficos** (el volumen grande de datos), ver ADR-003: los arrays de
datos viajan una vez y luego el frontend interactúa sin Julia.

## Flujo de datos: el viaje completo de una fórmula

```
1. Usuario tipea "√(x²+1)" en el <mathfield> de MathLive (React)
         │  (~0 ms, renderer local)
         ▼
2. MathLive emite MathJSON: ["Sqrt", ["Add", ["Power","x",2], 1]]
         │
         ▼
3. React (Zustand) actualiza el estado del documento (JSON)
         │  debounce 300 ms (evita evaluar en cada tecla)
         ▼
4. Rust recibe vía invoke() el AST + contexto (entorno de vars)
         │  serializa a JSON-RPC y escribe en stdin del sidecar
         │  (~50 µs)
         ▼
5. Julia parsea MathJSON → construcción de expresión Symbolics
         │  evalúa con el entorno del documento (vars + units)
         │  (0.5–200 ms típico; simbólico pesado hasta segundos)
         ▼
6. Julia serializa resultado: { value: "1.414…", unit: "1", latex: "..." }
         │  escribe en stdout (~50 µs)
         ▼
7. Rust lee stdout, emite evento Tauri al frontend
         │
         ▼
8. React pinta el resultado en la celda (≈0 ms)
```

Total: 8 pasos, pero los pasos 4 y 6 (IPC) son < 0.1% del tiempo total.

## Tamaños y rendimiento estimados

| Componente | Tamaño | Arranque |
|---|---|---|
| Binario Tauri (Rust) | 3–8 MB | < 100 ms |
| Frontend (React+MathLive+uPlot, gzip) | 1–2 MB | — |
| Sidecar Julia (sysimage con Symbolics+Unitful+CairoMakie) | 150–300 MB* | 1–3 s (sysimage) |
| Total instalado | ~200–350 MB | — |

*Julia pesa — es el costo de un CAS de verdad. Mitigaciones:
- `PackageCompiler.create_app` genera un bundle **relocatable** sin Julia instalada
- Se puede ofrecer build "lite" que use la Julia del sistema (juliaup) si el
  usuario ya la tiene (fase 4)
- Lazy loading: CairoMakie solo se carga al primer export (sysimage mínimo)

Comparación: Mathematica pesa 3 GB+, MathCAD ~1 GB, SMath ~50 MB sin CAS.
Nuestro peso es razonable para incluir un CAS completo.

## Tabla de responsabilidades (contrato entre capas)

### TypeScript/React — "La cara"
- Renderizar el worksheet (celdas, layout multi-columna)
- Editor matemático 2D (MathLive) con undo/redo
- Dibujar gráficos interactivos (uPlot 2D / WebGL 3D) — zoom/pan/hover
- Mostrar resultados + errores de cálculo
- Paleta de símbolos, atajos de teclado
- Preferencias de UI (tema, escala, dígitos)
- **NO** calcular nada matemático

### Rust — "El cerebro administrativo"
- Ventana, menús, diálogos nativos
- Comandos Tauri expuestos al frontend
- Spawn/supervisión del sidecar Julia (watchdog, reinicio)
- IPC JSON-RPC con el sidecar
- Guardar/cargar documentos JSON
- Importar `.mmt` (parser XML — Rust es bueno para esto)
- Exportar LaTeX/imagen (orchestra; Julia produce el contenido)
- **NO** calcular matemática (salvo trivialidades)

### Julia — "El cerebro matemático"
- Parser MathJSON → expresiones Julia/Symbolics
- Evaluación numérica (Float64/BigFloat/Complex) con **unidades** (Unitful)
- Álgebra simbólica (Symbolics: simplify, expand, diff, solve básico)
- Funciones de usuario del documento (entorno)
- FFT (FFTW), integrales numéricas (QuadGK), arrays
- Render de exportación (CairoMakie → SVG/PNG/PDF)
- Generación de LaTeX de resultados
- **NO** tocar filesystem (salvo export bajo pedido de Rust)
- **NO** tocar la UI
