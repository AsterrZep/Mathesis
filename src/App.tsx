// App.tsx — Fase 0: worksheet mínimo con una celda + resultado en vivo.
// Ciclo: MathLive → debounce 300ms → parse LaTeX→MathJSON (canonical:false)
//        → evalCell (Rust → Julia) → resultado.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ComputeEngine } from "@cortex-js/compute-engine";
import { MathField } from "./MathField";
import {
  type CellResult,
  type EngineStatus,
  engineStatus,
  evalCell,
  isTauri,
} from "./engine";
import "./App.css";

const DEBOUNCE_MS = 300;
const CELL_ID = "c1";

// Motor de parse compartido (instanciar es costoso; una vez por módulo)
const ce = new ComputeEngine();

export default function App() {
  const [result, setResult] = useState<CellResult | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const timer = useRef<number>(undefined);
  // Entorno de variables del documento (Fase 0: vacío — llega de otras celdas)
  const env = useRef<Record<string, unknown>>({});

  // Estado del motor al arrancar + evento "engine-ready"
  useEffect(() => {
    engineStatus().then(setStatus).catch(() => setStatus(null));
    if (!isTauri) return;
    const unlisten = listen("engine-ready", () =>
      engineStatus().then(setStatus),
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const evaluate = useCallback(async (latex: string) => {
    if (!latex.trim()) return;
    // canonical:false preserva el AST puro (["Divide",1,0] en vez de
    // "NaN"; ["Divide",1,3] en vez de ["Rational",…]) — la autoridad
    // matemática es Julia, no compute-engine.
    let ast: unknown;
    try {
      ast = ce.parse(latex, { canonical: false }).json;
    } catch {
      return; // LaTeX incompleto mientras se escribe
    }
    setEvaluating(true);
    try {
      const r = await evalCell(CELL_ID, ast, env.current);
      setResult(r);
    } catch (e) {
      // Error de IPC/RPC (no error matemático)
      setResult({
        status: "error",
        error: {
          code: "IPC",
          message: e instanceof Error ? e.message : String(e),
          cellId: CELL_ID,
        },
      });
    } finally {
      setEvaluating(false);
    }
  }, []);

  const onChange = useCallback(
    (latex: string) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void evaluate(latex), DEBOUNCE_MS);
    },
    [evaluate],
  );

  const chip =
    status === null
      ? { cls: "neutral", text: isTauri ? "motor…" : "mock (navegador)" }
      : status.spawnError
        ? { cls: "error", text: "sin motor Julia" }
        : status.ready
          ? { cls: "ok", text: "motor listo" }
          : { cls: "neutral", text: "iniciando motor…" };

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Mathesis</h1>
        <span className={`chip ${chip.cls}`}>{chip.text}</span>
      </header>

      <main className="worksheet">
        <section className="cell">
          <span className="cell-label">fórmula</span>
          <div className="cell-row">
            <MathField initial="2+2" onChange={onChange} />
            <span className="eq">=</span>
            <div className={`result ${result?.status ?? ""} ${evaluating ? "busy" : ""}`}>
              {result === null
                ? "…"
                : result.status === "ok"
                  ? <>
                      {result.value}
                      {result.unit !== "1" && <span className="unit">{result.unit}</span>}
                    </>
                  : <span
                      className="err"
                      title={result.error.message}
                    >
                      {result.error.code}: {result.error.message}
                    </span>}
            </div>
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <span>
          Fase 0 · MathJSON → Rust (Tauri) → Julia · escribe una fórmula para
          evaluarla en vivo
        </span>
        <span className="hint">2+2 · (x+1)*3 · 1/0 (prueba el error) · √2</span>
      </footer>
    </div>
  );
}
