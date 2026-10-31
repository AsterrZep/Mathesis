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

// Fase 1: catálogo ampliado (espejo de engine/src/mathjson.jl)
describe("mockEvalCell — catálogo Fase 1: trig, log, raíces, enteros", () => {
  it("trig completas: Cot, Sec, Csc", () => {
    expect(eval_(["Cot", Math.PI / 4])).toMatchObject({ status: "ok" });
    expect(eval_(["Sec", 0])).toMatchObject({ status: "ok", value: "1" });
    expect(eval_(["Csc", Math.PI / 2])).toMatchObject({ status: "ok", value: "1" });
  });

  it("inversas: Arccos (el nombre real de MathJSON), Arcsec, Arccsc", () => {
    expect(eval_(["Arccos", 1])).toMatchObject({ status: "ok", value: "0" });
    expect(eval_(["Acos", 1])).toMatchObject({ status: "ok", value: "0" });
    expect(eval_(["Arcsin", 0])).toMatchObject({ status: "ok", value: "0" });
    expect(eval_(["Arcsec", 1])).toMatchObject({ status: "ok", value: "0" });
    const r = eval_(["Arccsc", 1]);
    expect(r).toMatchObject({ status: "ok" });
    if (r.status === "ok") expect(parseFloat(r.value)).toBeCloseTo(Math.PI / 2);
  });

  it("hiperbólicas inversas", () => {
    expect(eval_(["Arcsinh", 0])).toMatchObject({ status: "ok", value: "0" });
    expect(eval_(["Arccosh", 1])).toMatchObject({ status: "ok", value: "0" });
    expect(eval_(["Arctanh", 0])).toMatchObject({ status: "ok", value: "0" });
  });

  it("log: Ln, Log base 10, Log con base arbitraria, Lb", () => {
    const ln = eval_(["Ln", Math.E]);
    expect(ln.status === "ok" && parseFloat(ln.value)).toBeCloseTo(1);
    expect(eval_(["Log", 100])).toMatchObject({ status: "ok", value: "2" });
    const lb3 = eval_(["Log", 9, 3]);
    expect(lb3.status === "ok" && parseFloat(lb3.value)).toBeCloseTo(2);
    expect(eval_(["Lb", 8])).toMatchObject({ status: "ok", value: "3" });
  });

  it("Root: orden par exige x ≥ 0; impar cubre ℝ", () => {
    expect(eval_(["Root", 8, 3])).toMatchObject({ status: "ok", value: "2" });
    expect(eval_(["Root", -8, 3])).toMatchObject({ status: "ok", value: "-2" });
    expect(eval_(["Root", 16, 4])).toMatchObject({ status: "ok", value: "2" });
  });

  it("Floor/Ceil/Round (ties away)/Sign", () => {
    expect(eval_(["Floor", 2.7])).toMatchObject({ status: "ok", value: "2" });
    expect(eval_(["Ceil", 2.1])).toMatchObject({ status: "ok", value: "3" });
    expect(eval_(["Round", 2.5])).toMatchObject({ status: "ok", value: "3" });
    expect(eval_(["Round", -2.5])).toMatchObject({ status: "ok", value: "-3" });
    expect(eval_(["Sign", -3])).toMatchObject({ status: "ok", value: "-1" });
  });

  it("Factorial, GCD, LCM, Mod", () => {
    expect(eval_(["Factorial", 5])).toMatchObject({ status: "ok", value: "120" });
    expect(eval_(["GCD", 12, 18])).toMatchObject({ status: "ok", value: "6" });
    expect(eval_(["LCM", 4, 6])).toMatchObject({ status: "ok", value: "12" });
    expect(eval_(["Mod", 7, 3])).toMatchObject({ status: "ok", value: "1" });
    expect(eval_(["Mod", -7, 3])).toMatchObject({ status: "ok", value: "2" });
  });

  it("Apply/InverseFunction: sin⁻¹ → [\"Apply\",[\"InverseFunction\",\"Sin\"],x]", () => {
    const r = eval_(["Apply", ["InverseFunction", "Sin"], 0.5]);
    expect(r.status === "ok" && parseFloat(r.value)).toBeCloseTo(Math.asin(0.5));
  });

  it("InvisibleOperator con nombre integrado: \\exp, \\gcd, sign", () => {
    expect(
      eval_(["InvisibleOperator", "Exp", ["Delimiter", 0]]),
    ).toMatchObject({ status: "ok", value: "1" });
    expect(
      eval_(["InvisibleOperator", "GCD", ["Delimiter", ["Sequence", 12, 18], "'(,)'"]]),
    ).toMatchObject({ status: "ok", value: "6" });
    expect(
      eval_(["InvisibleOperator", "sign", ["Delimiter", -2]]),
    ).toMatchObject({ status: "ok", value: "-1" });
  });

  it("nodos especiales: PositiveInfinity → INFINITY, Error → LATEX_INCOMPLETE", () => {
    expect(eval_("PositiveInfinity")).toMatchObject({
      status: "error",
      error: { code: "INFINITY" },
    });
    expect(eval_(["Error", "'unexpected-command'"])).toMatchObject({
      status: "error",
      error: { code: "LATEX_INCOMPLETE" },
    });
  });

  it("dominios del catálogo nuevo → DOMAIN/DIV_ZERO", () => {
    const cases: [unknown[], string][] = [
      [["Arcsin", 2], "DOMAIN"],
      [["Arccos", 2], "DOMAIN"],
      [["Ln", -1], "DOMAIN"],
      [["Log", -5], "DOMAIN"],
      [["Log", 8, 1], "DOMAIN"],
      [["Root", -8, 4], "DOMAIN"],
      [["Factorial", -1], "DOMAIN"],
      [["Factorial", 2.5], "DOMAIN"],
      [["GCD", 1.5, 2], "DOMAIN"],
      [["Arctanh", 2], "DOMAIN"],
      [["Arccosh", 0], "DOMAIN"],
      [["Mod", 5, 0], "DIV_ZERO"],
    ];
    for (const [ast, code] of cases) {
      expect(eval_(ast)).toMatchObject({
        status: "error",
        error: { code },
      });
    }
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
