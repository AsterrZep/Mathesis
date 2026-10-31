# 🎨 Diseño UI — Google Stitch (MCP)

Diseños generados con el MCP **Stitch** (`stitch.googleapis.com/mcp`, configurado
en `~/.config/opencode/opencode.json`) el 30-oct-2026.

- **Proyecto Stitch**: `projects/10423414734086294375`
  — "Mathesis — Super Calculadora (Worksheet UI)"
- **Pantalla generada**: `screens/c1e72512816d487bb6103a337f11704a` (desktop 2560×2050)

## Archivos

| Archivo | Descripción |
|---|---|
| `stitch-design.html` | HTML completo autocontenido (Tailwind CDN + Google Fonts) — abrir en navegador |
| `stitch-design.png` | Captura renderizada (1280×860) |

## Qué aporta el diseño (referencia para la UI de la Fase 1+)

- **Top bar**: brand con glifo ∫, chip de documento, pill "engine ready" con
  pulso, pestañas (Worksheet / Variables / Plots / History), acciones
  Insert Block / Run All / Export
- **Symbol Palette** (izquierda): pestañas Greek/Calc/Algeb/Const, grid de
  griegas, inserts rápidos (∫dx, d/dx, ∂/∂t, √x, ∑, ∏, ∞, ≈) y estructuras
  (fracción, potencia, subíndice, vector)
- **Worksheet central** (estilo Notion/MathCAD): celdas numeradas `[1]…[n]`,
  notación 2D real, unidades en pills verdes, resultados live, badges de
  régimen/error, celda activa con glow + autocompletado de variables
- **Inspector derecho**: gráfico de fase interactivo, sliders de parámetros,
  tabla de símbolos en scope (valor + dimensión)
- **Barra de estado**: kernel, precisión, engine

> Diseño de referencia — la implementación real sigue el stack propio
> (MathLive + uPlot); este mock define el look&feel objetivo y el catálogo
> de componentes (design system con tokens Material3 dark: `#111319` bg,
> `#6ea8fe` primary, `#4de082` tertiary).
