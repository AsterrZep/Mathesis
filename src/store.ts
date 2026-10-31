// store.ts — estado del documento worksheet (Zustand)
//
// Fuente de verdad = el documento JSON (celdas latex+ast). Los resultados
// llegan del engine Julia vía eval_document (Fase 1: variables/funciones
// encadenadas entre celdas).

import { create } from "zustand";
import type { DocCellResult, DocEvalResult } from "./engine";

export type CellType = "math" | "text";

export interface Cell {
  id: string;
  type: CellType;
  /** LaTeX de la celda (math) o texto plano (text) */
  latex: string;
}

let seq = 0;
const newId = () => `c${++seq}_${Date.now().toString(36)}`;

/** Semilla de demo: cadena de variables a=2 → b=a²+1 → b·3 + celda para el gráfico */
const SEED_CELLS: Cell[] = [
  { id: "c_a", type: "math", latex: "a=2" },
  { id: "c_b", type: "math", latex: "b=a^2+1" },
  { id: "c_calc", type: "math", latex: "b\\cdot 3" },
  { id: "c_txt", type: "text", latex: "Fase 1 — variables encadenadas: a=2, b=a²+1, y b·3 usa el resultado. Selecciona la celda de abajo para ver su gráfico." },
  { id: "c_plot", type: "math", latex: "\\sin(x)+\\frac{\\cos(2x)}{2}" },
];

interface DocState {
  docTitle: string;
  cells: Cell[];
  selectedId: string | null;
  results: Record<string, DocCellResult>;
  definitions: Record<string, number>;
  functions: string[];
  evaluating: boolean;

  addCell: (afterIndex: number, type: CellType) => void;
  removeCell: (id: string) => void;
  setLatex: (id: string, latex: string) => void;
  setSelected: (id: string | null) => void;
  setEvaluating: (b: boolean) => void;
  applyResult: (r: DocEvalResult) => void;
}

export const useDoc = create<DocState>((set) => ({
  docTitle: "Untitled.math",
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
      const cell: Cell = { id: newId(), type, latex: type === "text" ? "" : "" };
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

  setSelected: (id) => set({ selectedId: id }),
  setEvaluating: (b) => set({ evaluating: b }),

  applyResult: (r) =>
    set(() => {
      const results: Record<string, DocCellResult> = {};
      for (const cr of r.cells) results[cr.cellId] = cr;
      return { results, definitions: r.definitions ?? {}, functions: r.functions ?? [] };
    }),
}));

/** Cells → payload para invoke("eval_document") (las de texto van sin ast) */
export function cellsForEval(cells: Cell[]): Record<string, unknown>[] {
  return cells.map((c) => ({ cellId: c.id, type: c.type === "text" ? "text" : "expression" }));
}
