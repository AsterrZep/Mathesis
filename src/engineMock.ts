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

// Espejo de BUILTIN_NAMED en engine/src/mathjson.jl — funciones con nombre
// que MathJSON emite como ["InvisibleOperator","GCD",["Delimiter",…]]
const BUILTIN_NAMED: Record<string, string> = {
  GCD: "GCD", gcd: "GCD",
  LCM: "LCM", lcm: "LCM",
  Exp: "Exp", exp: "Exp",
  sign: "Sign", Sign: "Sign", Sgn: "Sign",
  abs: "Abs", sqrt: "Sqrt",
  min: "Min", max: "Max",
  ln: "Ln", log: "Log",
  Mod: "Mod", mod: "Mod",
};

// Espejo de INVERSE_FUNCTIONS en engine/src/mathjson.jl
const INVERSE_FUNCTIONS: Record<string, string> = {
  Sin: "Arcsin", Cos: "Arccos", Tan: "Arctan",
  Sec: "Arcsec", Csc: "Arccsc",
  Sinh: "Arcsinh", Cosh: "Arccosh", Tanh: "Arctanh",
};

const isDelimStyle = (x: unknown): x is string =>
  typeof x === "string" && /^'.*'$/.test(x);

function flattenCallItems(items: unknown[]): unknown[] {
  return items.flatMap(flattenCallOne);
}

function flattenCallOne(x: unknown): unknown[] {
  if (Array.isArray(x) && x.length > 0) {
    const op = String(x[0]);
    const rest = x.slice(1).filter((a) => !isDelimStyle(a));
    if (op === "Sequence") return flattenCallItems(rest);
    if (op === "Delimiter") return flattenCallItems(rest);
  }
  if (isDelimStyle(x)) return [];
  return [x];
}

const dcheck = (f: (x: number) => number, x: number, what: string): number => {
  const v = f(x);
  if (Number.isNaN(v)) {
    throw new MockMathError(
      "DOMAIN",
      `Valor fuera del dominio de ${what}`,
    );
  }
  return v;
};

const gcd2 = (x: number, y: number): number =>
  y === 0 ? Math.abs(x) : gcd2(y, x % y);
const lcm2 = (x: number, y: number): number =>
  x === 0 || y === 0 ? 0 : Math.abs(x * y) / gcd2(x, y);

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
    if (node === "PositiveInfinity" || node === "NegativeInfinity") {
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
    if (op === "Error") {
      throw new MockMathError(
        "LATEX_INCOMPLETE",
        "Expresión LaTeX incompleta o no soportada",
      );
    }
    // Función con nombre emitida como llamada implícita (espejo de
    // mathjson.jl: BUILTIN_NAMED) — \exp(x) → ["InvisibleOperator","Exp",…],
    // \gcd(12,18) → ["InvisibleOperator","GCD",["Delimiter",["Sequence",…]]]
    if (op === "InvisibleOperator" && typeof node[1] === "string") {
      const fname = node[1];
      if (fname in BUILTIN_NAMED) {
        const args = flattenCallItems(node.slice(2)).map((a) =>
          evalNode(a as Node, env),
        );
        return applyOp(BUILTIN_NAMED[fname], args);
      }
    }
    // Apply: f^{-1}(x) → ["Apply",["InverseFunction","Sin"],"x"]
    if (op === "Apply") {
      const fn = node[1];
      let fname: string;
      if (Array.isArray(fn) && fn[0] === "InverseFunction") {
        const inv = String(fn[1]);
        if (!(inv in INVERSE_FUNCTIONS)) {
          throw new MockMathError(
            "UNKNOWN_OP",
            `Función inversa no soportada: ${inv}`,
          );
        }
        fname = INVERSE_FUNCTIONS[inv];
      } else if (typeof fn === "string") {
        fname = fn;
      } else {
        throw new MockMathError("UNKNOWN_OP", "Apply con función no soportada");
      }
      const args = node.slice(2).map((a) => evalNode(a as Node, env));
      return applyOp(fname, args);
    }
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
    // Catálogo Fase 1 (espejo de engine/src/mathjson.jl): trig completas,
    // inversas, hiperbólicas, log con base, raíces, redondeo y enteros
    case "Sin": return Math.sin(a[0]);
    case "Cos": return Math.cos(a[0]);
    case "Tan": return Math.tan(a[0]);
    case "Cot": return Math.cos(a[0]) / Math.sin(a[0]);
    case "Sec": return 1 / Math.cos(a[0]);
    case "Csc": return 1 / Math.sin(a[0]);
    case "Arcsin": case "Asin": return dcheck(Math.asin, a[0], "arcsin");
    case "Arccos": case "Acos": return dcheck(Math.acos, a[0], "arccos");
    case "Arctan": case "Atan": return Math.atan(a[0]);
    case "Arcsec": return dcheck((x) => Math.acos(1 / x), a[0], "arcsec");
    case "Arccsc": return dcheck((x) => Math.asin(1 / x), a[0], "arccsc");
    case "Sinh": return Math.sinh(a[0]);
    case "Cosh": return Math.cosh(a[0]);
    case "Tanh": return Math.tanh(a[0]);
    case "Arcsinh": case "Asinh": return Math.asinh(a[0]);
    case "Arccosh": case "Acosh": return dcheck(Math.acosh, a[0], "arccosh");
    case "Arctanh": case "Atanh": return dcheck(Math.atanh, a[0], "arctanh");
    case "Ln": return dcheck(Math.log, a[0], "ln");
    case "Log": {
      if (a.length === 1) return dcheck(Math.log10, a[0], "log");
      if (a.length !== 2) {
        throw new MockMathError("INVALID_AST", "Log necesita 1 o 2 argumentos");
      }
      if (!(a[1] > 0) || a[1] === 1) {
        throw new MockMathError("DOMAIN", `Base de logaritmo inválida: ${a[1]}`);
      }
      return dcheck((x) => Math.log(x) / Math.log(a[1]), a[0], "log");
    }
    case "Lb": return dcheck(Math.log2, a[0], "lb");
    case "Max": return Math.max(...a);
    case "Min": return Math.min(...a);
    case "Root": {
      if (a.length !== 2) {
        throw new MockMathError("INVALID_AST", "Root necesita 2 argumentos");
      }
      const [x, n] = a;
      if (n === 0) throw new MockMathError("DOMAIN", "Raíz de orden 0");
      if (Number.isInteger(n)) {
        if (n % 2 === 0) {
          if (x < 0) {
            throw new MockMathError(
              "DOMAIN",
              "Raíz de orden par de número negativo",
            );
          }
          return Math.pow(x, 1 / n);
        }
        return Math.sign(x) * Math.pow(Math.abs(x), 1 / n);
      }
      if (x < 0) {
        throw new MockMathError(
          "DOMAIN",
          "Raíz de orden no entero de número negativo",
        );
      }
      return Math.pow(x, 1 / n);
    }
    case "Floor": return Math.floor(a[0]);
    case "Ceil": case "Ceiling": return Math.ceil(a[0]);
    // ties away from zero (paridad con Julia RoundNearestTiesAway)
    case "Round": return a[0] >= 0 ? Math.round(a[0]) : -Math.round(-a[0]);
    case "Sign": case "Sgn": return Math.sign(a[0]);
    case "Factorial": {
      const x = a[0];
      if (!(x >= 0) || !Number.isInteger(x)) {
        throw new MockMathError(
          "DOMAIN",
          "Factorial definido para enteros ≥ 0",
        );
      }
      if (x > 170) {
        throw new MockMathError("INFINITY", "Factorial desbordado (x > 170)");
      }
      let r = 1;
      for (let i = 2; i <= x; i++) r *= i;
      return r;
    }
    case "GCD": {
      if (a.length === 0 || !a.every((x) => Number.isInteger(x))) {
        throw new MockMathError("DOMAIN", "GCD requiere enteros");
      }
      return a.map((x) => Math.abs(x)).reduce(gcd2);
    }
    case "LCM": {
      if (a.length === 0 || !a.every((x) => Number.isInteger(x))) {
        throw new MockMathError("DOMAIN", "LCM requiere enteros");
      }
      return a.map((x) => Math.abs(x)).reduce(lcm2);
    }
    case "Mod": {
      if (a.length !== 2) {
        throw new MockMathError("INVALID_AST", "Mod necesita 2 argumentos");
      }
      if (a[1] === 0) throw new MockMathError("DIV_ZERO", "Módulo entre cero");
      return ((a[0] % a[1]) + a[1]) % a[1]; // signo del divisor (como Julia)
    }
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

// ── Fase 1: plot_data mock (navegador/tests sin Julia) ────────────────────
// Espejo de engine/src/plot.jl: muestrea la expresión con x libre; errores
// de dominio → null (gap de uPlot).

export function mockPlotData(
  ast: unknown,
  from: number,
  to: number,
  steps = 600,
  varName = "x",
  env: Record<string, number> = {},
) {
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const n = Math.min(Math.max(Math.trunc(steps), 2), 5000);
  const x: number[] = [];
  const y: (number | null)[] = [];
  let nonFinite = 0;
  for (let i = 0; i < n; i++) {
    const t = lo + ((hi - lo) * i) / (n - 1);
    x.push(t);
    const r = mockEvalCell("plot", ast, { ...env, [varName]: t });
    if (r.status === "ok") {
      const v = Number(r.value);
      if (Number.isFinite(v)) y.push(v);
      else { y.push(null); nonFinite++; }
    } else {
      y.push(null); nonFinite++;
    }
  }
  return { x, y, nonFinite, from: lo, to: hi };
}
