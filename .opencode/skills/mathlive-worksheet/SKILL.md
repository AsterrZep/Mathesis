---
name: MathLive Worksheet
description: Load when building the Mathesis worksheet UI in React — MathLive mathfield integration, MathJSON handling, cell components, Zustand document store, debounce evaluation cycle, undo/redo, or uPlot plotting.
---

# MathLive + Worksheet — patrones de frontend

## Ciclo de evaluación (patrón central)

```
keystroke → onChange(mathfield) → store.updateCell(ast)   [UI responde ya]
          → debounce 300 ms → invoke('eval_cell', {ast, env, cellId})
          → resultado → store.results[cellId] → re-render celda
```

Nunca bloquear la UI esperando Julia. Errores matemáticos se pintan inline.

## Wrapper de MathLive (`components/editor/MathField.tsx`)

```tsx
import 'mathlive';

interface Props {
  value: MathJSON | null;
  onChange: (mj: MathJSON) => void;
  readOnly?: boolean;
}

export function MathField({ value, onChange }: Props) {
  return (
    <math-field
      // MathLive emite 'input'; getValue('math-json') da el AST
      onInput={(ev) => {
        const mj = (ev.target as any).getValue('math-json');
        onChange(mj);
      }}
      ref={(el) => { if (el && value) el.setValue(value, { format: 'math-json' }); }}
    />
  );
}
```

- **MathJSON** = formato canónico del documento (ADR-005). `["Add",["Power","x",2],1]` = `x²+1`.
- LaTeX se obtiene igual con `getValue('latex')` (para display/export).
- Insertar estructuras con placeholders (∫ con huecos): usar `insert()` con
  `\placeholder{}` de MathLive. **Validar esta capacidad en la Fase 0** — es el
  riesgo #1 del MVP (`Documentacion/04-plan/mvp-definicion.md`).

## Store del documento (Zustand)

```ts
interface Cell { id: string; type: 'equation'|'expression'|'text'|'plot'|'interval';
                 ast: MathJSON | null; inRightOfPrevious?: boolean; /* … */ }
interface DocState {
  doc: { version: 1; meta: Meta; settings: Settings; cells: Cell[] };
  results: Record<string, CellResult>;
  updateCell(id: string, patch: Partial<Cell>): void;
  insertCell(afterId: string, type: Cell['type']): void;
  removeCell(id: string): void;
  undo(): void; redo(): void;
}
```

- El estado canónico ES el JSON del documento (mismo shape que `doc_save`).
- Undo: pila de **patches** (no snapshots) — patch inverso por operación.

## Componentes de celda

```
components/cells/
├── CellChrome.tsx      ← wrapper común (acciones hover, drag handle)
├── EquationCell.tsx    ← lhs = rhs + resultado a la derecha (como MathCAD)
├── ExpressionCell.tsx  ← expresión + resultado
├── TextCell.tsx        ← texto libre
├── PlotCell.tsx        ← uPlot
└── IntervalCell.tsx    ← rango x para plots (equidistant_interval)
```

Layout multi-columna (`inRightOfPrevious` del `.mmt` original): celdas con esa
flag se colocan a la derecha de la anterior (flex row de grupos).

## uPlot (`components/plot/Plot2D.tsx`)

```tsx
import uPlot from 'uplot';
// datos llegan de Julia: { x: number[], series: { id, y: number[] }[] }
const opts: uPlot.Options = {
  width, height,
  series: [{}, ...series.map(s => ({ label: s.id, stroke: colorDe(s.id), width: 2 }))],
  scales: { x: { time: false } },
};
new uPlot(opts, [data.x, ...data.series.map(s => s.y)], ref.current);
```

- Zoom/pan/tooltip son locales (sin roundtrip a Julia) — por diseño (ADR-003).
- Re-render solo cuando cambian los datos (ResizeObserver para resize).
- NaN en `y` donde la función diverge → uPlot hace gap automáticamente.

## Errores matemáticos

```ts
type CellResult = { status: 'ok'; value: string; unit: string; latex: string }
                | { status: 'error'; error: { code: string; message: string } };
// DIV_ZERO, UNDEFINED_VAR, UNIT_MISMATCH… → tooltip rojo inline en la celda
```

## Paleta de símbolos

Botones que hacen `mathfield.insert(latex)`:
`frac{}{}` · `^{} ` · `\sqrt[]{}` · `\int_{}^{} ` · `\sum_{}^{} ` · `\frac{}{}`
· letras griegas · `\left( \right)` — pestañas por categoría (como el original).

## Checklist Fase 0 (validar antes de comprometerse al plan completo)

- [ ] MathLive renderiza fracción 2D + potencia
- [ ] MathLive inserta ∫ con placeholders editables
- [ ] roundtrip MathJSON → setValue → getValue estable
- [ ] uPlot dibuja sin errores en la webview de Tauri
