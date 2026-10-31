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

export interface DocEvalResult {
  cells: DocCellResult[];
  definitions: Record<string, number>;
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

/** Evalúa el documento completo (Fase 1): propagación de variables. */
export async function evalDocument(
  cells: EvalCellPayload[],
): Promise<DocEvalResult> {
  if (isTauri) {
    // El parse LaTeX→MathJSON (canonical:false) lo hace Julia vía latex? NO —
    // el frontend parsea aquí abajo: ver parseCellAst()
    const payload = cells.map((c) => ({
      cellId: c.cellId,
      type: c.type,
      ast: c.type === "text" ? null : parseCellAst(c.latex),
    }));
    return await invoke<DocEvalResult>("eval_document", { cells: payload });
  }
  const { mockEvalDocument } = await import("./engineMock");
  return mockEvalDocument(cells.map((c) => ({
    cellId: c.cellId,
    type: c.type,
    ast: c.type === "text" ? null : parseCellAst(c.latex),
  })));
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

export async function engineStatus(): Promise<EngineStatus> {
  if (isTauri) {
    return await invoke<EngineStatus>("engine_status");
  }
  return { ready: true, spawnError: null };
}
