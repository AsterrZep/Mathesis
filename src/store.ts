// store.ts — estado del documento worksheet (Zustand)
//
// Fuente de verdad = el documento JSON (celdas latex+ast). Los resultados
// llegan del engine Julia vía eval_document (Fase 1: variables/funciones
// encadenadas entre celdas). Celdas plot/interval viven en la hoja y se
// muestrean vía plot_data.

import { create } from "zustand";
import type { DocCellResult, DocEvalResult } from "./engine";

export type CellType = "math" | "text" | "plot" | "interval";

/** Config de celda de gráfico: 1-2 expresiones y la variable libre */
export interface PlotConfig {
  f1: string;
  f2: string;
  varName: string;
}

/** Config de celda de intervalo: rango x que usan los gráficos situados debajo */
export interface IntervalConfig {
  from: string;
  to: string;
  steps: number;
}

export interface Cell {
  id: string;
  type: CellType;
  /** LaTeX de la celda (math) o texto plano (text) */
  latex: string;
  /** solo type="plot" */
  plot?: PlotConfig;
  /** solo type="interval" */
  interval?: IntervalConfig;
}

/** Documento persistido (doc_save/doc_open) — formato JSON propio v1 */
export interface DocFile {
  version: 1;
  title: string;
  cells: Cell[];
}

let seq = 0;
const newId = () => `c${++seq}_${Date.now().toString(36)}`;

/** Semilla de demo: variables a=2 → b=a²+1 → b·3 + intervalo + gráfico 2D */
const SEED_CELLS: Cell[] = [
  { id: "c_a", type: "math", latex: "a=2" },
  { id: "c_b", type: "math", latex: "b=a^2+1" },
  { id: "c_calc", type: "math", latex: "b\\cdot 3" },
  { id: "c_txt", type: "text", latex: "Fase 1 — variables encadenadas, gráfico 2D (celda de abajo, usa el intervalo) y guardado. Selecciona una fórmula para graficarla rápido en el inspector." },
  { id: "c_iv", type: "interval", latex: "", interval: { from: "-6.283", to: "6.283", steps: 400 } },
  { id: "c_plot", type: "plot", latex: "", plot: { f1: "\\sin(x)", f2: "\\cos(x)", varName: "x" } },
];

const EMPTY_DOC_CELLS = (): Cell[] => [{ id: newId(), type: "math", latex: "" }];

interface DocState {
  docTitle: string;
  /** Ruta del archivo abierto/guardado (null = sin guardar aún) */
  filePath: string | null;
  cells: Cell[];
  selectedId: string | null;
  results: Record<string, DocCellResult>;
  definitions: Record<string, number>;
  functions: string[];
  evaluating: boolean;

  addCell: (afterIndex: number, type: CellType) => void;
  removeCell: (id: string) => void;
  setLatex: (id: string, latex: string) => void;
  /** Patch genérico (config plot/interval, latex…) — no-op si nada cambia */
  patchCell: (id: string, patch: Partial<Cell>) => void;
  setSelected: (id: string | null) => void;
  setEvaluating: (b: boolean) => void;
  applyResult: (r: DocEvalResult) => void;
  setFilePath: (p: string | null) => void;
  setDocTitle: (t: string) => void;
  /** Carga un documento (ids regenerados → MathLive remonta limpio) */
  loadDoc: (path: string | null, doc: DocFile) => void;
  /** Documento nuevo vacío */
  newDoc: () => void;
}

export const useDoc = create<DocState>((set) => ({
  docTitle: "Untitled.math",
  filePath: null,
  cells: SEED_CELLS,
  // Semilla: la celda del gráfico arranca seleccionada → el inspector
  // muestra la curva al abrir la app (demo sin interacción)
  selectedId: "c_plot",
  results: {},
  definitions: {},
  functions: [],
  evaluating: false,

  addCell: (afterIndex, type) =>
    set((s) => {
      const cell: Cell =
        type === "plot"
          ? { id: newId(), type, latex: "", plot: { f1: "\\sin(x)", f2: "", varName: "x" } }
          : type === "interval"
            ? { id: newId(), type, latex: "", interval: { from: "-10", to: "10", steps: 400 } }
            : { id: newId(), type, latex: "" };
      const cells = [...s.cells];
      cells.splice(afterIndex + 1, 0, cell);
      return { cells, selectedId: cell.id };
    }),

  removeCell: (id) =>
    set((s) => {
      const cells = s.cells.filter((c) => c.id !== id);
      const results = { ...s.results };
      delete results[id];
      return { cells, results };
    }),

  setLatex: (id, latex) =>
    set((s) => ({
      cells: s.cells.map((c) => (c.id === id ? { ...c, latex } : c)),
    })),

  patchCell: (id, patch) =>
    set((s) => ({
      cells: s.cells.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // MathField emite al montar: si nada cambia devolver la MISMA
        // referencia evita re-renders en cadena del documento
        return JSON.stringify(next) === JSON.stringify(c) ? c : next;
      }),
    })),

  setSelected: (id) => set({ selectedId: id }),
  setEvaluating: (b) => set({ evaluating: b }),

  applyResult: (r) =>
    set(() => {
      const results: Record<string, DocCellResult> = {};
      for (const cr of r.cells) results[cr.cellId] = cr;
      return { results, definitions: r.definitions ?? {}, functions: r.functions ?? [] };
    }),

  setFilePath: (p) => set({ filePath: p }),
  setDocTitle: (t) => set({ docTitle: t }),

  loadDoc: (path, doc) =>
    set(() => ({
      filePath: path,
      docTitle: doc.title || "Untitled.math",
      // ids nuevos: MathField monta con `initial` — ids frescos = remontaje limpio
      cells: (doc.cells ?? []).map((c) => ({ ...c, id: newId() })),
      selectedId: null,
      results: {},
      definitions: {},
      functions: [],
    })),

  newDoc: () =>
    set(() => ({
      filePath: null,
      docTitle: "Untitled.math",
      cells: EMPTY_DOC_CELLS(),
      selectedId: null,
      results: {},
      definitions: {},
      functions: [],
    })),
}));

/** Cells → payload para invoke("eval_document") (las de texto van sin ast) */
export function cellsForEval(cells: Cell[]): Record<string, unknown>[] {
  return cells.map((c) => ({ cellId: c.id, type: c.type === "text" ? "text" : "expression" }));
}
