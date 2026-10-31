// Tests del store del documento: undo/redo (historial con coalescencia) y
// preferencias (settings). Espejo del comportamiento usado por App.tsx.

import { describe, expect, it } from "vitest";
import { useDoc } from "./store";

const fresh = () => useDoc.getState().newDoc();

describe("store — undo/redo", () => {
  it("addCell → undo lo quita → redo lo restaura", () => {
    fresh();
    const before = useDoc.getState().cells.length;
    useDoc.getState().addCell(0, "math");
    expect(useDoc.getState().cells.length).toBe(before + 1);
    useDoc.getState().undo();
    expect(useDoc.getState().cells.length).toBe(before);
    useDoc.getState().redo();
    expect(useDoc.getState().cells.length).toBe(before + 1);
  });

  it("setLatex coalesca el tecleo: 3 teclas seguidas = 1 undo", () => {
    fresh();
    const id = useDoc.getState().cells[0].id;
    useDoc.getState().setLatex(id, "1");
    useDoc.getState().setLatex(id, "1+");
    useDoc.getState().setLatex(id, "1+1");
    expect(useDoc.getState().cells[0].latex).toBe("1+1");
    useDoc.getState().undo();
    expect(useDoc.getState().cells[0].latex).toBe("");
  });

  it("removeCell es reversible con undo", () => {
    fresh();
    useDoc.getState().addCell(0, "math");
    const id = useDoc.getState().cells[1].id;
    useDoc.getState().removeCell(id);
    expect(useDoc.getState().cells.some((c) => c.id === id)).toBe(false);
    useDoc.getState().undo();
    expect(useDoc.getState().cells.some((c) => c.id === id)).toBe(true);
  });

  it("patchCell (intervalo) entra en el historial", () => {
    fresh();
    useDoc.getState().addCell(0, "interval");
    const cell = useDoc.getState().cells[1];
    useDoc.getState().patchCell(cell.id, { interval: { from: "-5", to: "5", steps: 100 } });
    expect(useDoc.getState().cells[1].interval).toMatchObject({ from: "-5" });
    useDoc.getState().undo();
    expect(useDoc.getState().cells[1].interval).toMatchObject({ from: "-10" });
  });

  it("loadDoc/newDoc limpian el historial", () => {
    useDoc.getState().addCell(0, "math");
    expect(useDoc.getState().history.past.length).toBeGreaterThan(0);
    useDoc.getState().loadDoc("/tmp/x.math.json", {
      version: 1,
      title: "x",
      cells: [],
    });
    expect(useDoc.getState().history.past).toHaveLength(0);
    expect(useDoc.getState().history.future).toHaveLength(0);
  });

  it("undo marca lastChangedId=null (siguiente eval = completa)", () => {
    fresh();
    const id = useDoc.getState().cells[0].id;
    useDoc.getState().setLatex(id, "42");
    expect(useDoc.getState().lastChangedId).toBe(id);
    useDoc.getState().undo();
    expect(useDoc.getState().lastChangedId).toBeNull();
  });
});

describe("store — preferencias del documento (settings)", () => {
  it("toggleTheme alterna dark↔light", () => {
    fresh();
    expect(useDoc.getState().settings.theme).toBe("dark");
    useDoc.getState().toggleTheme();
    expect(useDoc.getState().settings.theme).toBe("light");
    useDoc.getState().toggleTheme();
    expect(useDoc.getState().settings.theme).toBe("dark");
  });

  it("setSettings cambia dígitos y loadDoc persiste settings", () => {
    fresh();
    useDoc.getState().setSettings({ digits: 4, theme: "light" });
    expect(useDoc.getState().settings).toMatchObject({ digits: 4, theme: "light" });
    useDoc.getState().loadDoc("/tmp/p.math.json", {
      version: 1,
      title: "p",
      settings: { theme: "light", digits: 8 },
      cells: [],
    });
    expect(useDoc.getState().settings).toMatchObject({ theme: "light", digits: 8 });
  });
});
