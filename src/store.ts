// store.ts — estado del documento worksheet (Zustand)
//
// Fuente de verdad = el documento JSON (celdas latex+ast). Los resultados
// llegan del engine Julia vía eval_document (Fase 1: variables/funciones
// encadenadas entre celdas). Celdas plot/interval viven en la hoja y se
// muestrean vía plot_data.

import { create } from "zustand";
import { type DefinitionValue, type DocCellResult, type DocEvalResult } from "./engine";
import { type DocAsset, ingestImage } from "./imageAsset";

export type CellType = "math" | "text" | "plot" | "interval" | "image";

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
  /** solo type="image": id en doc.assets (dedup por hash) */
  assetId?: string;
}

/** Preferencias del documento (persistidas en doc.settings, Fase 1) */
export interface DocSettings {
  theme: "dark" | "light";
  /** dígitos significativos del formato numérico (lo aplica Julia) */
  digits: number;
  /** ancho de texto (heredado de .mmt textWidth, Fase 2) */
  textWidth?: number;
}

/** Metadatos importados de .mmt (opcionales) */
export interface DocMeta {
  author?: string;
  description?: string;
}

export const DEFAULT_SETTINGS: DocSettings = { theme: "dark", digits: 15 };

/** Documento persistido (doc_save/doc_open) — formato JSON propio v1 */
export interface DocFile {
  version: 1;
  title: string;
  settings?: DocSettings;
  meta?: DocMeta;
  /** Assets embebidos (imágenes) — solo los referenciados se guardan (GC) */
  assets?: Record<string, DocAsset>;
  cells: Cell[];
}

/** Assets referenciados por celdas de imagen → lo que viaja al disco */
export function usedAssets(
  cells: Cell[],
  assets: Record<string, DocAsset>,
): Record<string, DocAsset> {
  const out: Record<string, DocAsset> = {};
  for (const c of cells) {
    if (c.type === "image" && c.assetId && assets[c.assetId]) {
      out[c.assetId] = assets[c.assetId];
    }
  }
  return out;
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

/** Snapshot de undo: refs al array (structural sharing → barato) */
interface Snap {
  cells: Cell[];
  selectedId: string | null;
}
interface History {
  past: Snap[];
  future: Snap[];
}
const HISTORY_LIMIT = 100;
const EMPTY_HISTORY: History = { past: [], future: [] };

// Coalescencia del tecleo: varias teclas seguidas en la MISMA celda = 1 undo
let lastEdit = { id: "" as string, t: 0 };

interface DocState {
  docTitle: string;
  /** Ruta del archivo abierto/guardado (null = sin guardar aún) */
  filePath: string | null;
  cells: Cell[];
  selectedId: string | null;
  results: Record<string, DocCellResult>;
  definitions: Record<string, DefinitionValue>;
  functions: string[];
  evaluating: boolean;
  /** Preferencias (tema, dígitos) — se guardan en el documento */
  settings: DocSettings;
  /** Registro de imágenes del documento (dedup por hash de contenido) */
  assets: Record<string, DocAsset>;
  /** Metadatos (author/description) importados de .mmt — se conservan al guardar */
  meta?: DocMeta;
  /** Última celda matemática editada → evaluación incremental (null = completa) */
  lastChangedId: string | null;
  history: History;

  addCell: (afterIndex: number, type: CellType) => void;
  /** Inserta celda de imagen referenciando asset (lo registra si hace falta) */
  addImage: (afterIndex: number, assetId: string, asset: DocAsset) => void;
  /** Registra un asset sin crear celda (no-op si ya existe) */
  putAsset: (id: string, asset: DocAsset) => void;
  removeCell: (id: string) => void;
  setLatex: (id: string, latex: string) => void;
  /** Patch genérico (config plot/interval, latex…) — no-op si nada cambia */
  patchCell: (id: string, patch: Partial<Cell>) => void;
  setSelected: (id: string | null) => void;
  setEvaluating: (b: boolean) => void;
  applyResult: (r: DocEvalResult) => void;
  setFilePath: (p: string | null) => void;
  setDocTitle: (t: string) => void;
  setSettings: (patch: Partial<DocSettings>) => void;
  toggleTheme: () => void;
  undo: () => void;
  redo: () => void;
  /** Carga un documento (ids regenerados → MathLive remonta limpio) */
  loadDoc: (path: string | null, doc: DocFile) => void;
  /** Documento nuevo vacío */
  newDoc: () => void;
}

/** Empuja el snapshot actual al historial de undo (antes de mutar). */
const pushHistory = (s: DocState): History => ({
  past: [...s.history.past, { cells: s.cells, selectedId: s.selectedId }].slice(-HISTORY_LIMIT),
  future: [],
});

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
  settings: { ...DEFAULT_SETTINGS },
  assets: {},
  meta: undefined,
  lastChangedId: null,
  history: EMPTY_HISTORY,

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
      return { cells, selectedId: cell.id, history: pushHistory(s), lastChangedId: null };
    }),

  addImage: (afterIndex, assetId, asset) =>
    set((s) => {
      const cell: Cell = { id: newId(), type: "image", latex: "", assetId };
      const cells = [...s.cells];
      cells.splice(afterIndex + 1, 0, cell);
      // Solo se registra si no existía (dedup: la celda referencia el id)
      const assets = s.assets[assetId]
        ? s.assets
        : { ...s.assets, [assetId]: asset };
      return { cells, assets, selectedId: cell.id, history: pushHistory(s), lastChangedId: null };
    }),

  putAsset: (id, asset) =>
    set((s) => (s.assets[id] ? {} : { assets: { ...s.assets, [id]: asset } })),

  removeCell: (id) =>
    set((s) => {
      const cells = s.cells.filter((c) => c.id !== id);
      const results = { ...s.results };
      delete results[id];
      return { cells, results, history: pushHistory(s), lastChangedId: null };
    }),

  setLatex: (id, latex) =>
    set((s) => {
      const now = Date.now();
      // Coalescencia: tecleo continuo en la misma celda → un solo undo
      const coalesce = lastEdit.id === id && now - lastEdit.t < 800;
      lastEdit = { id, t: now };
      return {
        cells: s.cells.map((c) => (c.id === id ? { ...c, latex } : c)),
        history: coalesce ? s.history : pushHistory(s),
        lastChangedId: id,
      };
    }),

  patchCell: (id, patch) =>
    set((s) => {
      const target = s.cells.find((c) => c.id === id);
      const cells = s.cells.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // MathField emite al montar: si nada cambia devolver la MISMA
        // referencia evita re-renders en cadena del documento
        return JSON.stringify(next) === JSON.stringify(c) ? c : next;
      });
      const changed = cells !== s.cells;
      const isEvalCell = target?.type === "math" || target?.type === "text";
      return {
        cells,
        history: changed ? pushHistory(s) : s.history,
        lastChangedId: changed && isEvalCell ? id : s.lastChangedId,
      };
    }),

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

  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch }, lastChangedId: null })),

  toggleTheme: () =>
    set((s) => ({
      settings: {
        ...s.settings,
        theme: s.settings.theme === "dark" ? "light" : "dark",
      },
      lastChangedId: null,
    })),

  undo: () =>
    set((s) => {
      const prev = s.history.past[s.history.past.length - 1];
      if (!prev) return {};
      return {
        cells: prev.cells,
        selectedId: prev.selectedId,
        lastChangedId: null,
        history: {
          past: s.history.past.slice(0, -1),
          future: [
            { cells: s.cells, selectedId: s.selectedId },
            ...s.history.future,
          ].slice(0, HISTORY_LIMIT),
        },
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.history.future[0];
      if (!next) return {};
      return {
        cells: next.cells,
        selectedId: next.selectedId,
        lastChangedId: null,
        history: {
          past: [...s.history.past, { cells: s.cells, selectedId: s.selectedId }].slice(-HISTORY_LIMIT),
          future: s.history.future.slice(1),
        },
      };
    }),

  loadDoc: (path, doc) =>
    set(() => ({
      filePath: path,
      docTitle: doc.title || "Untitled.math",
      settings: { ...DEFAULT_SETTINGS, ...(doc.settings ?? {}) },
      meta: doc.meta,
      assets: { ...(doc.assets ?? {}) },
      // ids nuevos: MathField monta con `initial` — ids frescos = remontaje limpio
      // (los assetId de imagen se MANTIENEN: referencian doc.assets)
      cells: (doc.cells ?? []).map((c) => ({ ...c, id: newId() })),
      selectedId: null,
      results: {},
      definitions: {},
      functions: [],
      lastChangedId: null,
      history: EMPTY_HISTORY,
    })),

  newDoc: () =>
    set(() => ({
      filePath: null,
      docTitle: "Untitled.math",
      settings: { ...DEFAULT_SETTINGS },
      assets: {},
      meta: undefined,
      cells: EMPTY_DOC_CELLS(),
      selectedId: null,
      results: {},
      definitions: {},
      functions: [],
      lastChangedId: null,
      history: EMPTY_HISTORY,
    })),
}));

/** Cells → payload para invoke("eval_document") (las de texto van sin ast) */
export function cellsForEval(cells: Cell[]): Record<string, unknown>[] {
  return cells.map((c) => ({ cellId: c.id, type: c.type === "text" ? "text" : "expression" }));
}

// ── Imágenes (Fase 2): ingestión file → registro dedup → celda ─────────────

/**
 * Inserta un fichero de imagen como celda DESPUÉS de `afterIndex`:
 * hash → dedup (si ya existe solo se referencia) → compresión selectiva.
 */
export async function insertImageFile(file: File, afterIndex: number): Promise<void> {
  const s = useDoc.getState();
  const res = await ingestImage(file, (id) => Boolean(s.assets[id]));
  if (!res.dedup) s.putAsset(res.id, res.asset);
  s.addImage(afterIndex, res.id, res.asset);
}

/** Reemplaza la imagen de una celda existente (mismo pipeline de dedup). */
export async function replaceImageCell(cellId: string, file: File): Promise<void> {
  const s = useDoc.getState();
  const res = await ingestImage(file, (id) => Boolean(s.assets[id]));
  if (!res.dedup) s.putAsset(res.id, res.asset);
  s.patchCell(cellId, { assetId: res.id });
}
