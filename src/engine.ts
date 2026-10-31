// engine.ts — puente frontend ⇄ motor matemático (Fase 1: eval_document).
//
// En la app Tauri: invoke("eval_document") → Rust → sidecar Julia.
// Sin Tauri (vite dev en navegador, tests): mock en TS con el mismo subset
// MatJSON que el engine Julia (ver engineMock.ts).

import { invoke } from "@tauri-apps/api/core";
import { ComputeEngine } from "@cortex-js/compute-engine";

export interface CellResultOk {
  status: "ok";
  value: string;
  unit: string;
  type: string;
}
export interface CellResultErr {
  status: "error";
  error: { code: string; message: string; cellId?: string };
}
export type CellResult = CellResultOk | CellResultErr;

export interface EngineStatus {
  ready: boolean;
  spawnError: string | null;
}

/** Resultado por celda de eval_document */
export interface DocCellResult {
  cellId: string;
  status: "ok" | "error";
  value?: string;
  unit?: string;
  /** "text" | "definition" (f(x):=…) — opcional */
  kind?: string;
  /** variable definida en esta celda: {nombre: valor} */
  defines?: Record<string, number>;
  error?: { code: string; message: string; cellId?: string };
}

/** Valor de definición: número plano o cantidad con unidad (Fase 2) */
export type DefinitionValue = number | { value: number; unit: string };

export interface DocEvalResult {
  cells: DocCellResult[];
  definitions: Record<string, DefinitionValue>;
  functions: string[];
}

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Payload de celda para eval_document */
export interface EvalCellPayload {
  cellId: string;
  type: "expression" | "text";
  latex: string;
}

export interface EvalDocOptions {
  /**
   * Evaluación INCREMENTAL: solo estas celdas (y las que dependen de sus
   * símbolos) se re-evalúan en el engine; el resto sale de su caché.
   */
  changedCellIds?: string[];
  /** Dígitos significativos del formato numérico (settings.digits) */
  digits?: number;
}

/** Evalúa el documento completo (Fase 1): propagación de variables. */
export async function evalDocument(
  cells: EvalCellPayload[],
  opts: EvalDocOptions = {},
): Promise<DocEvalResult> {
  const payload = cells.map((c) => ({
    cellId: c.cellId,
    type: c.type,
    ast: c.type === "text" ? null : parseCellAst(c.latex),
  }));
  if (isTauri) {
    // El parse LaTeX→MathJSON (canonical:false) lo hace el frontend — ver
    // parseCellAst(); la autoridad matemática sigue siendo Julia (M-2)
    return await invoke<DocEvalResult>("eval_document", {
      cells: payload,
      changedCellIds: opts.changedCellIds ?? null,
      settings: opts.digits ? { digits: opts.digits } : null,
    });
  }
  const { mockEvalDocument } = await import("./engineMock");
  // El mock ignora changedCellIds (evalúa completo: mismos resultados)
  return mockEvalDocument(payload);
}

const ce = new ComputeEngine();

/**
 * LaTeX → MathJSON con canonical:false: preserva el AST puro
 * (["Divide",1,0] sin evaluar; sin ["Rational",…]) — la autoridad
 * matemática es Julia (M-2).
 * Devuelve null si el LaTeX está incompleto mientras se escribe.
 */
export function parseCellAst(latex: string): unknown {
  if (!latex.trim()) return null;
  try {
    return ce.parse(latex, { canonical: false }).json;
  } catch {
    return null;
  }
}

/** Evaluación puntual de una celda (compat con Fase 0 / mock en navegador) */
export async function evalCell(
  cellId: string,
  ast: unknown,
  env: Record<string, unknown> = {},
): Promise<CellResult> {
  if (isTauri) {
    return await invoke<CellResult>("eval_cell", { cellId, ast, env });
  }
  const { mockEvalCell } = await import("./engineMock");
  return mockEvalCell(cellId, ast, env);
}

/** Datos de gráfico (Fase 1): Julia muestrea, frontend dibuja (uPlot). */
export interface PlotData {
  x: number[];
  /** null = gap (dominio inválido); el frontend lo pasa a NaN */
  y: (number | null)[];
  nonFinite: number;
  from: number;
  to: number;
}

export async function plotData(
  ast: unknown,
  from: number,
  to: number,
  steps = 600,
  varName = "x",
  env: Record<string, DefinitionValue> = {},
): Promise<PlotData> {
  if (isTauri) {
    return await invoke<PlotData>("plot_data", {
      ast,
      xFrom: from,
      xTo: to,
      steps,
      varName,
      env,
    });
  }
  const { mockPlotData } = await import("./engineMock");
  return mockPlotData(ast, from, to, steps, varName, env);
}

export async function engineStatus(): Promise<EngineStatus> {
  if (isTauri) {
    return await invoke<EngineStatus>("engine_status");
  }
  return { ready: true, spawnError: null };
}

// ── Persistencia de documentos (Fase 1: doc_save / doc_open) ──────────────
// En Tauri: comandos Rust con diálogo nativo (tauri-plugin-dialog).
// Sin Tauri (vite dev en navegador): localStorage como sustituto.

const LS_KEY = "mathesis-doc";

export interface OpenedDoc {
  path: string;
  doc: unknown;
}

/** Guarda el documento; con path=null pide "Guardar como" nativo. */
export async function docSave(path: string | null, doc: unknown): Promise<string | null> {
  if (isTauri) {
    return await invoke<string | null>("doc_save", { path, doc });
  }
  localStorage.setItem(LS_KEY, JSON.stringify(doc));
  return path ?? "navegador:localStorage";
}

/** Abre un documento con el diálogo nativo (null si cancela). */
export async function docOpen(): Promise<OpenedDoc | null> {
  if (isTauri) {
    return await invoke<OpenedDoc | null>("doc_open");
  }
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return { path: "navegador:localStorage", doc: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export interface DocImportResult {
  path: string;
  doc: unknown;
  warnings: string[];
}

/** Importa un `.mmt` (XML del original) → JSON v1 (NO escribe disco). */
export async function docImport(): Promise<DocImportResult | null> {
  if (isTauri) {
    return await invoke<DocImportResult | null>("doc_import");
  }
  throw new Error("Import .mmt solo disponible en la app de escritorio");
}

/**
 * Guarda un artefacto generado en el frontend (PNG/SVG de figuras) con el
 * diálogo nativo. `b64` → content es base64 sin prefijo (PNG); sin b64 → texto.
 */
export async function saveArtifact(
  filename: string,
  ext: string,
  content: string,
  b64: boolean,
): Promise<string | null> {
  if (isTauri) {
    return await invoke<string | null>("save_artifact", { filename, ext, content, b64 });
  }
  // Navegador dev: descarga directa
  const url = b64
    ? `data:application/octet-stream;base64,${content}`
    : URL.createObjectURL(new Blob([content], { type: `image/${ext}` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  if (!b64) URL.revokeObjectURL(url);
  return filename;
}

/**
 * Exporta el documento (Fase 2: `latex` → .tex con resultados evaluados por
 * Julia). El doc debe llevar las celdas CON `ast` (parse canonical:false) y
 * `latex`. Guarda con diálogo nativo y devuelve la ruta (null = cancelado).
 */
export async function docExport(kind: string, doc: unknown): Promise<string | null> {
  if (isTauri) {
    return await invoke<string | null>("doc_export", { kind, path: null, doc });
  }
  throw new Error(
    "Export solo disponible en la app de escritorio (requiere el engine Julia)",
  );
}
