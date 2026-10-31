// Tests del mock engine — validan el contrato MathJSON ⇄ resultado que el
// engine Julia implementa (engine/src/mathjson.jl + eval.jl).
// Corren sin Julia: `pnpm test`

import { describe, expect, it } from "vitest";
import { mockEvalCell } from "./engineMock";

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
