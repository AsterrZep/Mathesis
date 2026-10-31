// engine.ts — puente frontend ⇄ motor matemático.
//
// En la app Tauri: invoke("eval_cell") → Rust → sidecar Julia.
// Sin Tauri (vite dev en navegador, tests): mock en TS con el mismo subset
// MatJSON que el engine Julia (ver engineMock.ts).

import { invoke } from "@tauri-apps/api/core";

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

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Evalúa una celda: MathJSON + entorno → resultado (o error de dominio). */
export async function evalCell(
  cellId: string,
  ast: unknown,
  env: Record<string, unknown> = {},
): Promise<CellResult> {
  if (isTauri) {
    return await invoke<CellResult>("eval_cell", { cellId, ast, env });
  }
  // Fallback navegador/tests → mock idéntico al subset del engine Julia
  const { mockEvalCell } = await import("./engineMock");
  return mockEvalCell(cellId, ast, env);
}

export async function engineStatus(): Promise<EngineStatus> {
  if (isTauri) {
    return await invoke<EngineStatus>("engine_status");
  }
  return { ready: true, spawnError: null };
}
