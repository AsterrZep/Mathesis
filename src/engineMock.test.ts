// Tests del mock engine — validan el contrato MathJSON ⇄ resultado que el
// engine Julia implementa (engine/src/mathjson.jl + eval.jl).
// Corren sin Julia: `pnpm test`

import { describe, expect, it } from "vitest";
import { mockEvalCell, mockEvalDocument, mockPlotData } from "./engineMock";

const eval_ = (ast: unknown, env: Record<string, unknown> = {}) =>
  mockEvalCell("c1", ast, env);

describe("mockEvalCell — operaciones básicas", () => {
  it("2 + 2 = 4", () => {
    expect(eval_(["Add", 2, 2])).toEqual({
      status: "ok",
      value: "4",
      unit: "1",
      type: "real",
    });
  });

  it("resta y negación", () => {
    expect(eval_(["Subtract", 10, 3])).toMatchObject({ value: "7" });
    expect(eval_(["Negate", 5])).toMatchObject({ value: "-5" });
  });

  it("multiplicación y división", () => {
    expect(eval_(["Multiply", 6, 7])).toMatchObject({ value: "42" });
    expect(eval_(["Divide", 1, 2])).toMatchObject({ value: "0.5" });
  });

  it("potencia y raíz", () => {
    expect(eval_(["Power", 2, 10])).toMatchObject({ value: "1024" });
    expect(eval_(["Sqrt", 2])).toMatchObject({ value: "1.4142135623730951" });
  });

  it("expresión anidada: (x+1)·3 con x=4 → 15", () => {
    expect(
      eval_(["Multiply", ["Add", "x", 1], 3], { x: { value: 4 } }),
    ).toMatchObject({ value: "15" });
  });
});

describe("mockEvalCell — errores de dominio (status=error, NO error RPC)", () => {
  it("división por cero → DIV_ZERO", () => {
    expect(eval_(["Divide", 1, 0])).toEqual({
      status: "error",
      error: { code: "DIV_ZERO", message: "División entre cero", cellId: "c1" },
    });
  });

  it("√ de negativo → DOMAIN", () => {
    expect(eval_(["Sqrt", -1])).toMatchObject({
      status: "error",
      error: { code: "DOMAIN" },
    });
  });

  it("variable no definida → UNDEFINED_VAR", () => {
    expect(eval_(["Add", "x", 1])).toMatchObject({
      status: "error",
      error: { code: "UNDEFINED_VAR" },
    });
  });

  it("operador desconocido → UNKNOWN_OP", () => {
    expect(eval_(["Integrate", 1, 2])).toMatchObject({
      status: "error",
      error: { code: "UNKNOWN_OP" },
    });
  });
});

describe("mockEvalCell — constantes y entorno", () => {
  it("constante π", () => {
    const r = eval_(["Multiply", "π", 2]);
    expect(r).toMatchObject({ status: "ok" });
    if (r.status === "ok") expect(parseFloat(r.value)).toBeCloseTo(2 * Math.PI);
  });

  it("entorno plano {x: 4} y anidado {x: {value: 4}}", () => {
    expect(eval_(["Add", "x", 0], { x: 4 })).toMatchObject({ value: "4" });
    expect(eval_(["Add", "x", 0], { x: { value: 4 } })).toMatchObject({
      value: "4",
    });
  });
});

// Nodos que produce ce.parse(latex, {canonical:false}) — espejo de los
// tests de engine/test/runtests.jl (contrato frontend↔Julia)
describe("mockEvalCell — nodos estructurales (canonical:false)", () => {
  it("Delimiter transparente: 2·(x+1) con x=4 → 10", () => {
    expect(
      eval_(
        ["Multiply", 2, ["Delimiter", ["Add", "x", 1]]],
        { x: 4 },
      ),
    ).toMatchObject({ status: "ok", value: "10" });
  });

  it("Delimiter vacío → INVALID_AST 'Paréntesis vacíos'", () => {
    expect(eval_(["Delimiter"])).toMatchObject({
      status: "error",
      error: { code: "INVALID_AST" },
    });
  });

  it("InvisibleOperator (multiplicación implícita): 2(x+1) → 10", () => {
    expect(
      eval_(
        ["InvisibleOperator", 2, ["Delimiter", ["Add", "x", 1]]],
        { x: 4 },
      ),
    ).toMatchObject({ status: "ok", value: "10" });
  });

  it("1/0 preservado como [Divide,1,0] → DIV_ZERO (no 'NaN')", () => {
    expect(eval_(["Divide", 1, 0])).toMatchObject({
      status: "error",
      error: { code: "DIV_ZERO" },
    });
  });

  it("string 'NaN' → error NAN (no UNDEFINED_VAR)", () => {
    expect(eval_("NaN")).toMatchObject({
      status: "error",
      error: { code: "NAN" },
    });
  });
});

// Fase 1: eval_document con propagación de variables (espejo de Julia)
describe("mockEvalDocument — variables encadenadas", () => {
  const eq = (cellId: string, ast: unknown) => ({ cellId, type: "expression", ast });
  const tx = (cellId: string) => ({ cellId, type: "text", ast: null });

  it("a=2 → b=a²+1 → b·3 con scope acumulado", () => {
    const r = mockEvalDocument([
      eq("c1", ["Equal", "a", 2]),
      eq("c2", ["Equal", "b", ["Add", ["Power", "a", 2], 1]]),
      eq("c3", ["Multiply", "b", 3]),
      tx("c4"),
    ]);
    const v = Object.fromEntries(r.cells.map((c) => [c.cellId, c.value ?? c.kind]));
    expect(v.c1).toBe("2");
    expect(v.c2).toBe("5");
    expect(v.c3).toBe("15");
    expect(r.definitions).toEqual({ a: 2, b: 5 });
    expect(r.cells[3]).toMatchObject({ kind: "text" });
  });

  it("error en una celda no detiene las siguientes", () => {
    const r = mockEvalDocument([
      eq("e1", ["Divide", 1, 0]),
      eq("e2", ["Equal", "ok_var", 7]),
      eq("e3", ["Add", "ok_var", 1]),
    ]);
    expect(r.cells[0].error?.code).toBe("DIV_ZERO");
    expect(r.cells[1].value).toBe("7");
    expect(r.cells[2].value).toBe("8");
  });

  it("definición de función f(x):=… se registra (evaluación solo en Julia)", () => {
    const r = mockEvalDocument([
      eq("f", ["Assign", "f", ["Function", ["Power", "x", 2], "x"]]),
    ]);
    expect(r.cells[0]).toMatchObject({ kind: "definition", value: "f(x)" });
    expect(r.functions).toEqual(["f"]);
  });
});

// Fase 1: plot_data mock (espejo de engine/src/plot.jl)
describe("mockPlotData — muestreo con x libre", () => {
  it("sin(x) sobre [-π,π] con 5 pts → [0,-1,0,1,0]", () => {
    const r = mockPlotData(["Sin", "x"], -Math.PI, Math.PI, 5);
    expect(r.x).toHaveLength(5);
    expect(r.y[0]).toBeCloseTo(0, 10);
    expect(r.y[1]).toBeCloseTo(-1, 10);
    expect(r.y[3]).toBeCloseTo(1, 10);
    expect(r.nonFinite).toBe(0);
  });

  it("√x con parte negativa → gaps (null)", () => {
    const r = mockPlotData(["Sqrt", "x"], -1, 1, 5);
    expect(r.y[0]).toBeNull();
    expect(r.y[2]).toBeCloseTo(0, 10);
    expect(r.nonFinite).toBe(2);
  });

  it("definitions del documento viajan: a·x con a=2", () => {
    const r = mockPlotData(["Multiply", "a", "x"], 0, 2, 3, "x", { a: 2 });
    expect(r.y).toEqual([0, 2, 4]);
  });
});
