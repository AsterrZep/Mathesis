# Stack: Frontend (React + TypeScript)

## Núcleo

| Lib | Versión | Rol |
|---|---|---|
| **React** | 19.x | UI |
| **TypeScript** | 5.x (strict) | Tipos |
| **Vite** | 6.x | Build + HMR |
| **Zustand** | 5.x | Estado global del documento (mínimo boilerplate) |
| **MathLive** | latest | ⭐ Editor matemático 2D (web component `<math-field>`) |
| **uPlot** | 1.6.x | ⭐ Gráficos 2D interactivos (canvas, ~45 KB) |
| **three** | r17x | Gráficos 3D (fase 3) |
| **i18next** | — | Internacionalización (fase 2) |

## MathLive — el editor matemático (pieza central)

**Qué es**: web component `<math-field>` que renderiza y edita expresiones
matemáticas en notación 2D real (fracciones apiladas, límites de integral,
matrices…). Entrada/salida **LaTeX** y **MathJSON**.

```tsx
import 'mathlive';

<math-field
  contenteditable
  virtual-keyboard-mode="onfocus"
  onChange={(ev) => {
    const mathJSON = ev.target.getValue('math-json');
    const latex = ev.target.getValue('latex');
    // → actualizar Zustand → debounce → evaluar vía IPC
  }}
/>
```

### Por qué MathLive

- ✅ Editor 2D completo "tipo MathCAD" sin escribir un renderer desde cero
- ✅ **MathJSON** como AST — el mismo formato usamos en el documento y para Julia
- ✅ Soporte de símbolos griegos, subíndices, fracciones, ∫ Σ √ (insesgado)
- ✅ Atajos tipo LaTeX (`\frac`, `\sqrt`) + paleta de símbolos
- ✅ Virtual keyboard (futuro soporte táctil)
- ✅ Accesibilidad (screen readers) y IME
- ✅ Licencia Apache-2.0 (compatible con cualquier licencia nuestra)

### Limitaciones a tener en cuenta

- El "modo estructura" (insertar un ∫ con huecos) requiere manejar selección
  de regiones — hay API para esto (`applyStyle`, `insert`, placeholders)
- Undo interno de MathLive se coordina con nuestro undo global (o delegamos en
  MathLive por celda)

## MathJSON — el formato de fórmulas

Estándar abierto (Cortex.js). Representación en arrays anidados:

| Expresión | MathJSON |
|---|---|
| `x² + 2x + 1` | `["Add", ["Power","x",2], ["Multiply",2,"x"], 1]` |
| `sin(α)² + cos(α)²` | `["Add", ["Power",["Sin","α"],2], ["Power",["Cos","α"],2]]` |
| `√(x+1)` | `["Sqrt", ["Add","x",1]]` |
| `∫₀¹ f(x)dx` | `["Integrate", ["Apply",{"ref":"f"},"x"], ["Tuple","x",0,1]]` |
| `5 m` (unidades) | `["Multiply", 5, {"sym":"Meter"}]` (aprox) |

### Librería estándar MathJSON (referencia)

- Aritmética: `Add` `Multiply` `Divide` `Power` `Negate` `Sqrt` `Root`…
- Funciones: `Sin` `Cos` `Tan` `Asin`… `Exp` `Log` `Ln` `Log`…
- Cálculo: `Derivative` `Integrate` `Limit` `Sum` `Product`…
- Estadística: `Mean` `StandardDeviation` `Erf`…
- Números: `Pi` `ExponentialE` `ImaginaryUnit` `Infinity`…
- Complejos: `Real` `Im` `Conjugate`…

Nuestro traductor Julia (mathjson.jl) cubre este subconjón + nuestros
operadores internos.

## uPlot — gráficos 2D

```tsx
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const opts = {
  width: 600, height: 400,
  series: [
    {},
    { label: '1+f(x)', stroke: '#FF0043', width: 2, points: { show: false } },
    { label: '1−f(x)', stroke: '#0000FF', width: 2 },
  ],
  scales: { x: { time: false }, y: { type: 'linear' } },
  axes: [{ grid: { show: true } }, { grid: { show: true } }],
};
new uPlot(opts, [xValues, y1, y2], plotElement);
```

- Julia manda `[x[], series[{id, y[]}]]` → uPlot dibuja
- Zoom/pan/legend/tooltip nativos — **sin tocar Julia**
- ~45 KB gzip, dibuja 1M puntos a 60 fps

## Estado global (Zustand)

```ts
interface DocState {
  doc: Document;                    // documento canónico (JSON)
  results: Record<string, CellResult>; // resultados por cellId
  selectedCell: string | null;
  // acciones
  updateCell(id: string, patch: Partial<Cell>): void;
  insertCell(afterId: string, type: CellType): void;
  removeCell(id: string): void;
  moveCell(id: string, dir: -1 | 1): void;
  undo(): void; redo(): void;
  // engine
  evaluate(): Promise<void>;        // debounce + IPC
}
```

## Ciclo de evaluación en React

```
keystroke en <math-field>
  → onChange → updateCell(ast) en store (instantáneo, UI responde)
  → debounce 300 ms (o blur de la celda)
  → invoke('eval_cell', {ast, env, cellId})
  → resultado → results[cellId] → re-render de la celda
  → si error matemático → pintar inline (estilo rojo + tooltip)
```

## Estructura de componentes

```
components/
├── App.tsx                    ← layout: toolbar + worksheet + status bar
├── Toolbar.tsx                ← acciones: nuevo, abrir, guardar, export…
├── SymbolPalette.tsx          ← pestañas de símbolos (frac, ∫, Σ, griegas…)
├── Worksheet.tsx              ← lista virtualizada de celdas
├── cells/
│   ├── CellChrome.tsx         ← contenedor común (borde, acciones hover)
│   ├── EquationCell.tsx       ← lhs = rhs (MathLive ×2 + resultado)
│   ├── ExpressionCell.tsx     ← expresión libre + resultado
│   ├── ResultCell.tsx         ← resultado guardado (solo lectura)
│   ├── TextCell.tsx           ← texto libre (markdown-lite)
│   ├── PlotCell.tsx           ← uPlot + opciones
│   ├── IntervalCell.tsx       ← definición de rango para plots
│   └── ImageCell.tsx          ← imagen embebida (base64)
├── editor/
│   ├── MathField.tsx          ← wrapper tipado de <math-field>
│   └── ResultView.tsx         ← render del resultado (valor + unidad + latex)
└── plot/
    ├── Plot2D.tsx             ← uPlot wrapper
    └── Plot3D.tsx             ← three.js (fase 3)
```

## Estilos

- CSS Modules o Tailwind (decidir en fase 0) — el original usa Material
- Tema claro/oscuro con CSS variables
- **MathLive tiene temas propios** (`mathfield.setOptions({fontsDirectory})`) —
  hay que armonizar con nuestro tema

## Testing

| Herramienta | Para qué |
|---|---|
| **Vitest** | Unit tests (mathjson helpers, store) |
| **Testing Library** | Componentes React |
| **Playwright** | E2E: abrir app, escribir fórmula, ver resultado (con engine mockeado) |
| **Mock engine** | Stub del sidecar en TS para tests sin Julia |

## Bundle size estimado

| Paquete | gzip |
|---|---|
| React + ReactDOM | ~45 KB |
| MathLive | ~250 KB |
| uPlot | ~45 KB |
| Zustand | ~3 KB |
| App propia | ~30 KB |
| **Total** | **~370 KB** |

Ligero comparado con Electron (~150 MB) o Mathematica.
