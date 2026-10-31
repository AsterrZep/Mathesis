// mathfield-registry.ts — instancia del mathfield con foco actual.
// La paleta de símbolos inserta en él (MathLive vive fuera del árbol React
// por montaje imperativo, así que usamos este registro global).

import type { MathfieldElement } from "mathlive";

let active: MathfieldElement | null = null;

export function setActiveMathfield(mf: MathfieldElement | null): void {
  active = mf;
}

export function getActiveMathfield(): MathfieldElement | null {
  return active;
}

/** Inserta LaTeX en el mathfield activo (si lo hay) */
export function insertIntoActive(latex: string): boolean {
  if (!active) return false;
  try {
    active.insert(latex, { focus: true, feedback: true });
    return true;
  } catch {
    try {
      active.setValue(active.getValue("latex") + latex);
      return true;
    } catch {
      return false;
    }
  }
}
