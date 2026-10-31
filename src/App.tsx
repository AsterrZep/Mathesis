// App.tsx — Fase 1: worksheet multi-celda con variables encadenadas.
// Layout estilo Stitch (Documentacion/07-diseno/): topbar · paleta ·
// celdas numeradas · inspector de scope · statusbar.
//
// Ciclo: MathCell → debounce 400ms → parse (canonical:false) →
//       invoke("eval_document") (Rust → Julia) → resultados por celda.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { Topbar, SymbolPalette, CellRow, Inspector, StatusBar } from "./components";
import { insertImageFile, useDoc, usedAssets, type DocFile } from "./store";
import {
  type EngineStatus,
  docExport,
  docImport,
  docOpen,
  docSave,
  engineStatus,
  evalDocument,
  isTauri,
  parseCellAst,
} from "./engine";
import "./App.css";

const DEBOUNCE_MS = 400;

export default function App() {
  const { t } = useTranslation();
  const cells = useDoc((s) => s.cells);
  const selectedId = useDoc((s) => s.selectedId);
  const evaluating = useDoc((s) => s.evaluating);
  const setEvaluating = useDoc((s) => s.setEvaluating);
  const applyResult = useDoc((s) => s.applyResult);
  const addCell = useDoc((s) => s.addCell);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const canUndo = useDoc((s) => s.history.past.length > 0);
  const canRedo = useDoc((s) => s.history.future.length > 0);
  const settings = useDoc((s) => s.settings);
  const toggleTheme = useDoc((s) => s.toggleTheme);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const seq = useRef(0);
  const imgInputRef = useRef<HTMLInputElement>(null);

  /** Índice donde insertar (tras la celda seleccionada, o al final) */
  const insertIndex = useCallback(() => {
    const s = useDoc.getState();
    const i = s.cells.findIndex((c) => c.id === s.selectedId);
    return i >= 0 ? i : s.cells.length - 1;
  }, []);

  const onPickImage = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      await insertImageFile(file, insertIndex());
    },
    [insertIndex],
  );

  // Pegar imagen del portapapeles (Ctrl+V) → celda de imagen directa
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void onPickImage(f);
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPickImage]);

  // Tema claro/oscuro del documento (settings.theme, persistido en el doc)
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  // Ancho del texto (settings.textWidth, %) → ancho de la hoja
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--doc-width",
      String(settings.textWidth ?? 100),
    );
  }, [settings.textWidth]);

  // Estado del motor al arrancar + eventos del watchdog:
  // "engine-ready" (hand-shake) y "engine-status" (restarted → re-evaluar)
  useEffect(() => {
    engineStatus().then(setStatus).catch(() => setStatus(null));
    if (!isTauri) return;
    const un1 = listen("engine-ready", () => engineStatus().then(setStatus));
    const un2 = listen<{ reason?: string }>("engine-status", (e) => {
      engineStatus().then(setStatus);
      if (e.payload?.reason === "restarted") void runEvalRef.current();
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  const runEval = useCallback(async () => {
    const mySeq = ++seq.current;
    setEvaluating(true);
    try {
      const s = useDoc.getState();
      // Solo math/text viajan a eval_document — plot/interval se muestrean
      // aparte vía plot_data desde sus propias celdas
      const mathCells = s.cells.filter(
        (c) => c.type === "math" || c.type === "text",
      );
      const payload = mathCells.map((c) => ({
        cellId: c.id,
        type: (c.type === "text" ? "text" : "expression") as
          | "text"
          | "expression",
        latex: c.latex,
      }));
      // Incremental: si solo cambió una celda matemática, el engine re-evalúa
      // solo ella + sus dependientes (grafo + caché en Julia)
      const changed =
        s.lastChangedId && mathCells.some((c) => c.id === s.lastChangedId)
          ? [s.lastChangedId]
          : undefined;
      const r = await evalDocument(payload, {
        changedCellIds: changed,
        digits: s.settings.digits,
      });
      // guard anti-race: solo aplicar si es la última petición
      if (mySeq === seq.current) applyResult(r);
    } catch (e) {
      console.error("eval_document IPC:", e);
    } finally {
      if (mySeq === seq.current) setEvaluating(false);
    }
  }, [applyResult, setEvaluating]);

  // El listener del watchdog necesita runEval sin re-registrar el effect
  const runEvalRef = useRef(runEval);
  runEvalRef.current = runEval;

  // ── Documento: guardar / abrir / nuevo (Fase 1: doc_save/doc_open) ──────
  const saveNow = useCallback(async () => {
    const s = useDoc.getState();
    const doc: DocFile = {
      version: 1,
      title: s.docTitle,
      settings: s.settings,
      meta: s.meta,
      // GC de assets: solo las imágenes referenciadas viajan al disco
      assets: usedAssets(s.cells, s.assets),
      cells: s.cells,
    };
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
      settings: doc.settings,
      assets: doc.assets,
      cells: doc.cells,
    });
  }, []);

  const newNow = useCallback(() => {
    const s = useDoc.getState();
    if (
      s.cells.length > 1 &&
      !window.confirm(t("confirm.newDoc"))
    ) {
      return;
    }
    s.newDoc();
  }, []);

  // ── Import .mmt (Fase 2): XML del original → JSON v1 → loadDoc sin guardar ─
  const importNow = useCallback(async () => {
    try {
      const r = await docImport();
      if (!r) return; // cancelado
      const doc = r.doc as Partial<DocFile> | null;
      if (!doc || !Array.isArray(doc.cells)) {
        window.alert(t("imp.emptyCells"));
        return;
      }
      // filePath = null a propósito: el .mmt NO es nuestro JSON — al guardar
      // se ofrecerá "Guardar como"
      useDoc.getState().loadDoc(null, {
        version: 1,
        title: doc.title ?? "Importado",
        settings: doc.settings,
        meta: doc.meta,
        assets: doc.assets,
        cells: doc.cells,
      });
      if (r.warnings.length > 0) {
        const shown = r.warnings.slice(0, 8).join("\n• ");
        const more =
          r.warnings.length > 8
            ? `\n${t("imp.more", { n: r.warnings.length - 8 })}`
            : "";
        window.alert(`${t("imp.warningsHead")}\n• ${shown}${more}`);
      }
    } catch (e) {
      window.alert(t("imp.failed", { msg: e instanceof Error ? e.message : e }));
    }
  }, []);

  // ── Export (Fase 2): latex + ast → engine genera el .tex → diálogo nativo ─
  const exportNow = useCallback(async () => {
    const s = useDoc.getState();
    const cells = s.cells
      .filter((c) => c.type === "math" || c.type === "text")
      .map((c) => ({
        cellId: c.id,
        type: (c.type === "text" ? "text" : "expression") as
          | "text"
          | "expression",
        latex: c.latex,
        ast: c.type === "text" ? null : parseCellAst(c.latex),
      }));
    try {
      const p = await docExport("latex", { version: 1, title: s.docTitle, cells });
      if (p) console.info("[export] guardado en", p);
    } catch (e) {
      window.alert(t("export.failed", { msg: e instanceof Error ? e.message : e }));
    }
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
      // Undo/Redo a nivel documento — dentro de un mathfield, MathLive tiene
      // su propio undo y no se intercepta
      if (mod && (key === "z" || key === "y")) {
        const ae = document.activeElement as HTMLElement | null;
        if (
          ae &&
          (ae.tagName === "MATH-FIELD" || ae.closest?.(".mathfield-host"))
        ) {
          return;
        }
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo();
        else undo();
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
  }, [saveNow, openNow, newNow, undo, redo]);

  // Debounce: re-evaluar el documento al cambiar cualquier celda o los
  // dígitos significativos (settings.digits → formato de Julia)
  useEffect(() => {
    const t = window.setTimeout(() => void runEval(), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [cells, runEval, settings.digits]);

  const chip =
    status === null
      ? { cls: "neutral", text: isTauri ? t("engine.booting") : t("engine.mock") }
      : status.spawnError
        ? { cls: "error", text: t("engine.noEngine") }
        : status.ready
          ? { cls: "ok", text: t("engine.ready") }
          : { cls: "neutral", text: t("engine.starting") };

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
        onImport={() => void importNow()}
        onSave={() => void saveNow()}
        onExport={() => void exportNow()}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        theme={settings.theme}
        onToggleTheme={toggleTheme}
        evaluating={evaluating}
      />
      <div className="workbench">
        <SymbolPalette />
        <main className="worksheet">
          <div className="sheet-canvas">
            <div className="sheet-header">
              <div className="sh-meta">
                <span className="sh-crumb">{t("header.crumb")}</span>
                <span>·</span>
                <span>Mathesis Worksheet</span>
                <span>·</span>
                <span>{t("header.phase")}</span>
              </div>
              <h1 className="sh-title">{t("header.title")}</h1>
              <p className="sh-desc">{t("header.desc")}</p>
            </div>
            <div className="cells">
              {cells.map((c, i) => (
                <CellRow key={c.id} cell={c} index={i} />
              ))}
            </div>
            <div className="add-block-row">
              <input
                ref={imgInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void onPickImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button className="add-block" onClick={() => addCell(cells.length - 1, "math")}>
                {t("add.formula")}
              </button>
              <button className="add-block" onClick={() => addCell(cells.length - 1, "text")}>
                {t("add.text")}
              </button>
              <button
                className="add-block"
                title={t("add.imageTitle")}
                onClick={() => imgInputRef.current?.click()}
              >
                {t("add.image")}
              </button>
              <button
                className="add-block"
                title={t("add.intervalTitle")}
                onClick={() => addCell(cells.length - 1, "interval")}
              >
                {t("add.interval")}
              </button>
              <button
                className="add-block"
                title={t("add.plotTitle")}
                onClick={() => addCell(cells.length - 1, "plot")}
              >
                {t("add.plot")}
              </button>
            </div>
          </div>
        </main>
        <Inspector />
      </div>
      <StatusBar
        engineText={
          isTauri
            ? t("statusbar.engineJulia", { state: chip.text })
            : t("statusbar.engineMock")
        }
      />
    </div>
  );
}
