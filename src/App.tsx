// App.tsx — Fase 1: worksheet multi-celda con variables encadenadas.
// Layout estilo Stitch (Documentacion/07-diseno/): topbar · paleta ·
// celdas numeradas · inspector de scope · statusbar.
//
// Ciclo: MathCell → debounce 400ms → parse (canonical:false) →
//       invoke("eval_document") (Rust → Julia) → resultados por celda.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Topbar, SymbolPalette, CellRow, Inspector, StatusBar } from "./components";
import { useDoc } from "./store";
import {
  type EngineStatus,
  engineStatus,
  evalDocument,
  isTauri,
} from "./engine";
import "./App.css";

const DEBOUNCE_MS = 400;

export default function App() {
  const cells = useDoc((s) => s.cells);
  const selectedId = useDoc((s) => s.selectedId);
  const evaluating = useDoc((s) => s.evaluating);
  const setEvaluating = useDoc((s) => s.setEvaluating);
  const applyResult = useDoc((s) => s.applyResult);
  const addCell = useDoc((s) => s.addCell);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const seq = useRef(0);

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

  const runEval = useCallback(async () => {
    const mySeq = ++seq.current;
    setEvaluating(true);
    try {
      const payload = useDoc.getState().cells.map((c) => ({
        cellId: c.id,
        type: (c.type === "text" ? "text" : "expression") as
          | "text"
          | "expression",
        latex: c.latex,
      }));
      const r = await evalDocument(payload);
      // guard anti-race: solo aplicar si es la última petición
      if (mySeq === seq.current) applyResult(r);
    } catch (e) {
      console.error("eval_document IPC:", e);
    } finally {
      if (mySeq === seq.current) setEvaluating(false);
    }
  }, [applyResult, setEvaluating]);

  // Debounce: re-evaluar el documento al cambiar cualquier celda
  useEffect(() => {
    const t = window.setTimeout(() => void runEval(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [cells, runEval]);

  const chip =
    status === null
      ? { cls: "neutral", text: isTauri ? "motor…" : "mock (navegador)" }
      : status.spawnError
        ? { cls: "error", text: "sin motor Julia" }
        : status.ready
          ? { cls: "ok", text: "engine ready" }
          : { cls: "neutral", text: "iniciando motor…" };

  const onInsert = () => {
    const idx = selectedId
      ? cells.findIndex((c) => c.id === selectedId)
      : cells.length - 1;
    addCell(idx < 0 ? cells.length - 1 : idx, "math");
  };

  return (
    <div className="app">
      <Topbar
        engineLabel={chip}
        onInsert={onInsert}
        onRun={() => void runEval()}
        evaluating={evaluating}
      />
      <div className="workbench">
        <SymbolPalette />
        <main className="worksheet">
          <div className="sheet-canvas">
            <div className="sheet-header">
              <div className="sh-meta">
                <span className="sh-crumb">📁 Documento</span>
                <span>·</span>
                <span>Mathesis Worksheet</span>
                <span>·</span>
                <span>Fase 1</span>
              </div>
              <h1 className="sh-title">Hoja de cálculo matemática</h1>
              <p className="sh-desc">
                Cada celda se evalúa en orden con el motor Julia: define{" "}
                <b>a</b>, encadena <b>b=a²+1</b>, usa resultados en la
                siguiente celda — y observa la tabla de símbolos a la derecha.
              </p>
            </div>
            <div className="cells">
              {cells.map((c, i) => (
                <CellRow key={c.id} cell={c} index={i} />
              ))}
            </div>
            <button
              className="add-block"
              onClick={() => addCell(cells.length - 1, "math")}
            >
              ＋ Add formula or text block
            </button>
          </div>
        </main>
        <Inspector />
      </div>
      <StatusBar
        engineText={
          isTauri
            ? `◉ ${chip.text} · julia sidecar · RPC json-ndjson`
            : "◉ mock navegador · sin Julia"
        }
      />
    </div>
  );
}
