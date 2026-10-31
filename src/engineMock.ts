// engineMock.ts — evaluador MathJSON en TS (ESPEJO del engine Julia).
//
// Cubre el subset de la Fase 0: Add, Subtract, Multiply, Divide, Power,
// Negate, Sqrt, Exp, Abs + constantes π/e + variables del entorno.
// Se usa en: (1) vite dev sin Tauri, (2) tests unitarios (sin Julia).
// MANTENER SINCRONIZADO con engine/src/mathjson.jl.

import type { CellResult } from "./engine";

export class MockMathError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Node = number | string | unknown[];

function evalNode(node: Node, env: Record<string, number>): number {
  if (typeof node === "number") {
    return node;
  }
  if (typeof node === "string") {
    // Nodos numéricos especiales (JSON no admite NaN/Infinity literales)
    if (node === "NaN") {
      throw new MockMathError(
        "NAN",
        "La expresión evalúa a NaN (¿división 0/0 o ∞−∞?)",
      );
    }
    if (node === "Infinity" || node === "+Infinity" || node === "-Infinity") {
      throw new MockMathError(
        "INFINITY",
        "La expresión evalúa a ±∞ (¿división entre cero?)",
      );
    }
    if (node in env) return env[node];
    if (node === "π" || node === "Pi") return Math.PI;
    if (node === "e") return Math.E;
    throw new MockMathError("UNDEFINED_VAR", `Variable no definida: ${node}`);
  }
  if (Array.isArray(node)) {
    if (node.length === 0) {
      throw new MockMathError("INVALID_AST", "Nodo MathJSON vacío");
    }
    const op = String(node[0]);
    const args = node.slice(1).map((a) => evalNode(a as Node, env));
    return applyOp(op, args);
  }
  throw new MockMathError(
    "INVALID_AST",
    `Nodo MathJSON no soportado: ${typeof node}`,
  );
}

function applyOp(op: string, a: number[]): number {
  switch (op) {
    case "Add":
      return a.reduce((s, x) => s + x, 0);
    case "Subtract":
      return a.length === 1 ? -a[0] : a.reduce((s, x) => s - x);
    case "Multiply":
      return a.reduce((s, x) => s * x, 1);
    case "Divide":
      if (a.length !== 2) {
        throw new MockMathError("INVALID_AST", "Divide necesita 2 argumentos");
      }
      if (a[1] === 0) {
        throw new MockMathError("DIV_ZERO", "División entre cero");
      }
      return a[0] / a[1];
    case "Power":
      return Math.pow(a[0], a[1]);
    case "Negate":
      return -a[0];
    case "Sqrt":
      if (a[0] < 0) {
        throw new MockMathError(
          "DOMAIN",
          "Raíz cuadrada de número negativo",
        );
      }
      return Math.sqrt(a[0]);
    case "Exp":
      return Math.exp(a[0]);
    case "Abs":
      return Math.abs(a[0]);
    // Nodos estructurales (canonical:false de compute-engine) — espejo de
    // engine/src/mathjson.jl
    case "Delimiter":
      if (a.length !== 1) {
        throw new MockMathError("INVALID_AST", "Paréntesis vacíos");
      }
      return a[0];
    case "InvisibleOperator":
      if (a.length === 0) {
        throw new MockMathError("INVALID_AST", "Expresión incompleta");
      }
      return a.reduce((s, x) => s * x, 1);
    case "InvisibleTimes":
      return a.reduce((s, x) => s * x, 1);
    case "Tuple":
      if (a.length === 0) {
        throw new MockMathError("INVALID_AST", "Paréntesis vacíos");
      }
      throw new MockMathError(
        "UNSUPPORTED",
        "Listas/tuplas: soporte de arrays en Fase 3",
      );
    case "Sequence":
      if (a.length === 0) {
        throw new MockMathError("INVALID_AST", "Expresión vacía");
      }
      return a[a.length - 1];
    default:
      throw new MockMathError("UNKNOWN_OP", `Operación no soportada aún: ${op}`);
  }
}

function formatNumber(x: number): string {
  if (Number.isInteger(x) && Math.abs(x) < 1e15) {
    return String(x);
  }
  return String(x);
}

export function mockEvalCell(
  cellId: string,
  ast: unknown,
  env: Record<string, unknown> = {},
): CellResult {
  // Entorno: { x: 4 } o { x: { value: 4 } } (igual que el engine Julia)
  const flatEnv: Record<string, number> = {};
  for (const [name, spec] of Object.entries(env)) {
    if (typeof spec === "number") flatEnv[name] = spec;
    else if (spec && typeof spec === "object" && "value" in spec) {
      const v = (spec as { value: unknown }).value;
      if (typeof v === "number") flatEnv[name] = v;
    }
  }
  return runMockEval(cellId, ast, flatEnv);
}

function runMockEval(
  cellId: string,
  ast: unknown,
  vars: Record<string, number>,
): CellResult {
  try {
    const x = evalNode(ast as Node, vars);
    if (Number.isNaN(x)) {
      throw new MockMathError("NAN", "Resultado no es un número");
    }
    if (!Number.isFinite(x)) {
      throw new MockMathError("INFINITY", "Resultado infinito");
    }
    return { status: "ok", value: formatNumber(x), unit: "1", type: "real" };
  } catch (e) {
    if (e instanceof MockMathError) {
      return {
        status: "error",
        error: { code: e.code, message: e.message, cellId },
      };
    }
    return {
      status: "error",
      error: {
        code: "INTERNAL",
        message: e instanceof Error ? e.message : String(e),
        cellId,
      },
    };
  }
}

// ── Fase 1: eval_document en el mock (variables encadenadas) ──────────────
// Espejo de engine/src/eval.jl. LIMITACIÓN del mock: funciones de usuario
// (f(x):=…) solo en el engine Julia — en navegador/mock dan UNDEFINED_VAR.

export interface DocMockCell {
  cellId: string;
  type: string;
  ast: unknown;
}
export interface DocMockResult {
  cells: {
    cellId: string;
    status: "ok" | "error";
    value?: string;
    unit?: string;
    kind?: string;
    defines?: Record<string, number>;
    error?: { code: string; message: string; cellId?: string };
  }[];
  definitions: Record<string, number>;
  functions: string[];
}

export function mockEvalDocument(cells: DocMockCell[]): DocMockResult {
  const vars: Record<string, number> = {};
  const functions: string[] = [];
  const out: DocMockResult["cells"] = [];

  for (const c of cells) {
    if (c.type === "text") {
      out.push({ cellId: c.cellId, status: "ok", kind: "text" });
      continue;
    }
    if (c.ast === null || c.ast === undefined) {
      out.push({
        cellId: c.cellId,
        status: "error",
        error: { code: "INVALID_AST", message: "Falta el AST", cellId: c.cellId },
      });
      continue;
    }
    try {
      const ast = c.ast;
      if (Array.isArray(ast) && ast[0] === "Equal") {
        const lhs = ast[1];
        if (typeof lhs !== "string") {
          throw new MockMathError(
            "UNSUPPORTED",
            "El lado izquierdo de = debe ser un símbolo simple",
          );
        }
        const val = evalNode(ast[2] as Node, vars);
        vars[lhs] = val;
        out.push({
          cellId: c.cellId,
          status: "ok",
          value: formatNumber(val),
          unit: "1",
          defines: { [lhs]: val },
        });
      } else if (Array.isArray(ast) && ast[0] === "Assign") {
        const lhs = ast[1];
        if (typeof lhs !== "string") {
          throw new MockMathError("UNSUPPORTED", "El nombre debe ser un símbolo simple");
        }
        const rhs = ast[2];
        if (Array.isArray(rhs) && rhs[0] === "Function") {
          functions.push(lhs);
          out.push({
            cellId: c.cellId,
            status: "ok",
            kind: "definition",
            value: `${lhs}(${(rhs.slice(2) as unknown[]).join(", ")})`,
          });
        } else {
          const val = evalNode(rhs as Node, vars);
          vars[lhs] = val;
          out.push({
            cellId: c.cellId,
            status: "ok",
            value: formatNumber(val),
            unit: "1",
            defines: { [lhs]: val },
          });
        }
      } else {
        const r = runMockEval(c.cellId, c.ast, vars);
        out.push({ cellId: c.cellId, ...r } as (typeof out)[number]);
      }
    } catch (e) {
      const err =
        e instanceof MockMathError
          ? { code: e.code, message: e.message }
          : {
              code: "INTERNAL",
              message: e instanceof Error ? e.message : String(e),
            };
      out.push({ cellId: c.cellId, status: "error", error: { ...err, cellId: c.cellId } });
    }
  }
  return { cells: out, definitions: vars, functions: functions.sort() };
}
