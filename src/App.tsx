// App.tsx — Fase 1: worksheet multi-celda con variables encadenadas.
// Layout estilo Stitch (Documentacion/07-diseno/): topbar · paleta ·
// celdas numeradas · inspector de scope · statusbar.
//
// Ciclo: MathCell → debounce 400ms → parse (canonical:false) →
//       invoke("eval_document") (Rust → Julia) → resultados por celda.

import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Topbar, SymbolPalette, CellRow, Inspector, StatusBar } from "./components";
import { useDoc, type DocFile } from "./store";
import {
  type EngineStatus,
  docOpen,
  docSave,
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
      // Solo math/text viajan a eval_document — plot/interval se muestrean
      // aparte vía plot_data desde sus propias celdas
      const payload = useDoc.getState()
        .cells.filter((c) => c.type === "math" || c.type === "text")
        .map((c) => ({
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

  // ── Documento: guardar / abrir / nuevo (Fase 1: doc_save/doc_open) ──────
  const saveNow = useCallback(async () => {
    const s = useDoc.getState();
    const doc: DocFile = { version: 1, title: s.docTitle, cells: s.cells };
    const p = await docSave(s.filePath, doc);
    if (p) {
      s.setFilePath(p);
      const base = p.split(/[\\/]/).pop();
      if (base) s.setDocTitle(base);
    }
  }, []);

  const openNow = useCallback(async () => {
    const r = await docOpen();
    if (!r) return;
    const doc = r.doc as Partial<DocFile> | null;
    if (!doc || !Array.isArray(doc.cells)) {
      console.warn("doc_open: formato no reconocido", r);
      return;
    }
    useDoc.getState().loadDoc(r.path, {
      version: 1,
      title: doc.title ?? "Untitled.math",
      cells: doc.cells,
    });
  }, []);

  const newNow = useCallback(() => {
    const s = useDoc.getState();
    if (
      s.cells.length > 1 &&
      !window.confirm("¿Documento nuevo? Se descartan los cambios sin guardar.")
    ) {
      return;
    }
    s.newDoc();
  }, []);

  // Atajos: Ctrl/Cmd+S guardar · Ctrl/Cmd+O abrir · Ctrl/Cmd+N nuevo ·
  // Enter (fuera de un editor) = nueva fórmula debajo de la seleccionada
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (mod && key === "o") {
        e.preventDefault();
        void openNow();
        return;
      }
      if (mod && key === "n") {
        e.preventDefault();
        newNow();
        return;
      }
      if (e.key === "Enter" && !mod) {
        const ae = document.activeElement as HTMLElement | null;
        // No interceptar mientras se escribe en un editor
        if (
          ae &&
          (ae.tagName === "INPUT" ||
            ae.tagName === "TEXTAREA" ||
            ae.tagName === "MATH-FIELD" ||
            ae.closest?.(".mathfield-host"))
        ) {
          return;
        }
        const s = useDoc.getState();
        const i = s.cells.findIndex((c) => c.id === s.selectedId);
        if (i < 0) return;
        e.preventDefault();
        s.addCell(i, "math");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow, openNow, newNow]);

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
        onNew={newNow}
        onOpen={() => void openNow()}
        onSave={() => void saveNow()}
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
            <div className="add-block-row">
              <button className="add-block" onClick={() => addCell(cells.length - 1, "math")}>
                ＋ Add formula
              </button>
              <button className="add-block" onClick={() => addCell(cells.length - 1, "text")}>
                ＋ Text block
              </button>
              <button
                className="add-block"
                title="Rango x para los gráficos de debajo"
                onClick={() => addCell(cells.length - 1, "interval")}
              >
                ＋ Interval
              </button>
              <button
                className="add-block"
                title="Gráfico 2D (1-2 expresiones, muestreo en Julia)"
                onClick={() => addCell(cells.length - 1, "plot")}
              >
                ＋ Plot
              </button>
            </div>
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
