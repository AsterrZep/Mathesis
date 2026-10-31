// components.tsx — componentes de layout estilo Stitch (ver
// Documentacion/07-diseno/): topbar, paleta de símbolos, celdas,
// inspector de scope, statusbar.

import { useCallback, useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useDoc, type Cell } from "./store";
import { MathField } from "./MathField";
import { insertIntoActive } from "./mathfield-registry";
import { type PlotData, parseCellAst, plotData } from "./engine";

// ── Topbar (brand ∫ + doc chip + pill engine + acciones) ─────────────────
export function Topbar({
  engineLabel,
  onInsert,
  onRun,
  evaluating,
}: {
  engineLabel: { cls: string; text: string };
  onInsert: () => void;
  onRun: () => void;
  evaluating: boolean;
}) {
  const docTitle = useDoc((s) => s.docTitle);
  return (
    <header className="topbar">
      <div className="tb-left">
        <div className="brand-mark">∫</div>
        <span className="brand-name">Mathesis</span>
        <span className="tb-sep" />
        <div className="doc-chip" title="Documento">
          <span className="doc-icon">▤</span>
          <span>{docTitle}</span>
          <span className="doc-ok">●</span>
        </div>
        <div className={`engine-pill ${engineLabel.cls}`}>
          <span className="pulse-dot" />
          <span>{engineLabel.text}</span>
        </div>
      </div>
      <div className="tb-right">
        <button className="btn btn-ghost" onClick={onInsert}>
          ＋ Insert Block
        </button>
        <button className="btn btn-ghost" onClick={onRun} disabled={evaluating}>
          <span className="btn-ico">▶</span> {evaluating ? "…" : "Run All"}
        </button>
        <button className="btn btn-primary" title="Fase 2" disabled>
          ⤓ Export
        </button>
      </div>
    </header>
  );
}

// ── Symbol Palette (izquierda, estilo Stitch) ─────────────────────────────
const PALETTE: Record<string, [label: string, latex: string][]> = {
  Greek: [
    ["α", "\\alpha "], ["β", "\\beta "], ["γ", "\\gamma "], ["δ", "\\delta "], ["ε", "\\epsilon "],
    ["θ", "\\theta "], ["λ", "\\lambda "], ["μ", "\\mu "], ["π", "\\pi "], ["σ", "\\sigma "],
    ["φ", "\\phi "], ["ω", "\\omega "], ["Δ", "\\Delta "], ["Σ", "\\Sigma "], ["Ω", "\\Omega "],
  ],
  Calc: [
    ["∫ dx", "\\int_{}^{} "], ["d/dx", "\\frac{d}{dx} "], ["∂/∂t", "\\frac{\\partial}{\\partial t} "],
    ["√x", "\\sqrt{}"], ["∑", "\\sum_{}^{} "], ["∏", "\\prod_{}^{} "],
    ["∞", "\\infty "], ["lim", "\\lim_{} "],
  ],
  Algeb: [
    ["·", "\\cdot "], ["±", "\\pm "], ["×", "\\times "], ["≤", "\\leq "],
    [">=", "\\geq "], ["≠", "\\neq "], ["≈", "\\approx "], ["⇒", "\\Rightarrow "],
  ],
  Const: [
    ["π", "\\pi "], ["e", "e"], ["∞", "\\infty "], ["φ", "\\varphi "], ["ℏ", "\\hbar "],
  ],
};

export function SymbolPalette() {
  const [tab, setTab] = useState("Greek");
  return (
    <aside className="palette">
      <div className="pal-head">
        <div className="pal-title-row">
          <span className="pal-title">Symbol Palette</span>
          <span className="pal-tag">TeX</span>
        </div>
        <div className="pal-sub">LaTeX &amp; Math Engine Ready</div>
      </div>
      <div className="pal-tabs">
        {Object.keys(PALETTE).map((t) => (
          <button
            key={t}
            className={t === tab ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "Algeb" ? "Algeb" : t}
          </button>
        ))}
      </div>
      <div className="pal-grid">
        {PALETTE[tab].map(([label, latex]) => (
          <button
            key={label + latex}
            title={`insertar ${latex}`}
            onClick={() => insertIntoActive(latex)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="pal-section-label">Structures</div>
      <div className="pal-structs">
        {[
          ["a/b", "\\frac{}{}"],
          ["x^n", "^{}"],
          ["x_i", "_{}"],
          ["( )", "\\left(\\right)"],
        ].map(([label, latex]) => (
          <button key={label} onClick={() => insertIntoActive(latex)}>
            <span className="st-math">{label}</span>
            <span className="st-lbl">{label === "a/b" ? "Fraction" : label === "x^n" ? "Power" : label === "x_i" ? "Subscript" : "Group"}</span>
          </button>
        ))}
      </div>
      <div className="pal-footer">
        <span>⌨ Focusea una fórmula e inserta</span>
      </div>
    </aside>
  );
}

// ── Celda del worksheet (gutter numerado + contenido + resultado) ─────────
export function CellRow({ cell, index }: { cell: Cell; index: number }) {
  const result = useDoc((s) => s.results[cell.id]);
  const selected = useDoc((s) => s.selectedId === cell.id);
  const setLatex = useDoc((s) => s.setLatex);
  const setSelected = useDoc((s) => s.setSelected);
  const removeCell = useDoc((s) => s.removeCell);

  return (
    <div
      className={`cell ${selected ? "sel" : ""} ${cell.type === "text" ? "cell-text" : ""}`}
      onMouseDown={() => setSelected(cell.id)}
    >
      <div className="cell-gutter">
        <span className="cell-num">[{index + 1}]</span>
        <button
          className="cell-del"
          title="Eliminar celda"
          onClick={(e) => {
            e.stopPropagation();
            removeCell(cell.id);
          }}
        >
          ×
        </button>
      </div>
      <div className="cell-body">
        {cell.type === "math" ? (
          <MathField initial={cell.latex} onChange={(l) => setLatex(cell.id, l)} />
        ) : (
          <textarea
            className="cell-textarea"
            value={cell.latex}
            rows={2}
            placeholder="Texto…"
            onChange={(e) => setLatex(cell.id, e.target.value)}
            onFocus={() => setSelected(cell.id)}
          />
        )}
      </div>
      <div className="cell-result">
        {result === undefined ? (
          <span className="res-idle" />
        ) : result.status === "error" ? (
          <span className="err-badge" title={result.error?.message}>
            {result.error?.code}: {result.error?.message}
          </span>
        ) : result.kind === "text" ? (
          <span className="res-idle" />
        ) : result.kind === "definition" ? (
          <span className="pill pill-dim" title="función de usuario definida">
            {result.value}
          </span>
        ) : (
          <span className="pill" title="resultado (Julia)">
            {result.value}
            {result.unit && result.unit !== "1" && (
              <span className="pill-unit">{result.unit}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Inspector derecho (gráfico uPlot + scope symbols) ─────────────────────
function PlotPanel() {
  const cell = useDoc((s) =>
    s.selectedId ? s.cells.find((c) => c.id === s.selectedId) : undefined,
  );
  const definitions = useDoc((s) => s.definitions);
  const [range, setRange] = useState<[number, number]>([-10, 10]);
  const [data, setData] = useState<PlotData | null>(null);
  const [plotState, setPlotState] = useState<
    "idle" | "loading" | "ok" | "error" | "noplot"
  >("idle");
  const [errMsg, setErrMsg] = useState("");
  const plotRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);

  const mathSelected = cell !== undefined && cell.type === "math";
  const latex = cell?.latex ?? "";

  // Auto-plot (debounce 500) al cambiar selección/contenido/rango
  const doPlot = useCallback(async () => {
    if (!mathSelected || !latex.trim()) {
      setData(null);
      setPlotState("idle");
      return;
    }
    const ast = parseCellAst(latex);
    if (!ast) {
      setData(null);
      setPlotState("noplot");
      return;
    }
    setPlotState("loading");
    try {
      const d = await plotData(ast, range[0], range[1], 600, "x", definitions);
      setData(d);
      setPlotState("ok");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : String(e));
      setPlotState("error");
    }
  }, [mathSelected, latex, range, definitions]);

  useEffect(() => {
    const t = window.setTimeout(() => void doPlot(), 500);
    return () => window.clearTimeout(t);
  }, [doPlot]);

  // Montaje/destrucción de uPlot (gap con NaN, tema oscuro)
  useEffect(() => {
    if (!data || !plotRef.current) return;
    uplotRef.current?.destroy();
    const axisFont = '10px "JetBrains Mono", monospace';
    const opts: uPlot.Options = {
      width: plotRef.current.clientWidth || 268,
      height: 190,
      series: [
        {},
        {
          label: latex.length > 22 ? latex.slice(0, 22) + "…" : latex,
          stroke: "#6ea8fe",
          width: 2,
          points: { show: false },
        },
      ],
      scales: { x: { time: false } },
      axes: [
        {
          stroke: "#8c919d",
          font: axisFont,
          grid: { stroke: "#424751", width: 1 },
          ticks: { stroke: "#424751" },
        },
        {
          stroke: "#8c919d",
          font: axisFont,
          grid: { stroke: "#424751", width: 1 },
          ticks: { stroke: "#424751" },
        },
      ],
      legend: { show: false },
    };
    // null → NaN (gap nativo de uPlot)
    const ys = data.y.map((v) => (v === null ? NaN : v));
    const p = new uPlot(opts, [data.x, ys], plotRef.current);
    uplotRef.current = p;
    return () => {
      p.destroy();
      uplotRef.current = null;
    };
  }, [data, latex]);

  return (
    <>
      <div className="insp-title-row">
        <span className="insp-title">⌗ Interactive Phase Plot</span>
        <span className="insp-badge">{plotState === "ok" ? "live" : "uPlot"}</span>
      </div>
      <div className="plot-range">
        <label>
          x ∈ [
          <input
            type="number"
            value={range[0]}
            step={1}
            onChange={(e) =>
              setRange([Number(e.target.value) || -10, range[1]])
            }
          />
          ,
          <input
            type="number"
            value={range[1]}
            step={1}
            onChange={(e) =>
              setRange([range[0], Number(e.target.value) || 10])
            }
          />
          ]
        </label>
        <button className="btn btn-mini" onClick={() => void doPlot()}>
          ↻
        </button>
      </div>
      {plotState === "idle" && (
        <div className="plot-placeholder">
          <div className="ph-icon">📈</div>
          <div>
            Selecciona una celda matemática
            <br />
            (p.ej. <b>sin(x)</b>) — se grafica
            <br />
            sola en el rango x
          </div>
        </div>
      )}
      {plotState === "loading" && (
        <div className="plot-placeholder">◉ muestreando en Julia…</div>
      )}
      {plotState === "noplot" && (
        <div className="plot-placeholder">La celda no es una expresión válida</div>
      )}
      {plotState === "error" && (
        <div className="plot-placeholder plot-err">⚠ {errMsg}</div>
      )}
      {plotState === "ok" && data && (
        <>
          <div className="plot-canvas" ref={plotRef} />
          <div className="plot-meta">
            <span>{data.x.length} pts</span>
            {data.nonFinite > 0 && (
              <span className="plot-gaps">● {data.nonFinite} fuera de dominio (gap)</span>
            )}
            <span className="plot-hint">arrastra = zoom · doble clic = reset</span>
          </div>
        </>
      )}
    </>
  );
}

export function Inspector() {
  const definitions = useDoc((s) => s.definitions);
  const functions = useDoc((s) => s.functions);
  const entries = Object.entries(definitions);
  return (
    <aside className="inspector">
      <PlotPanel />
      <div className="insp-title-row">
        <span className="insp-title">Scope Symbols</span>
        <span className="insp-badge">{entries.length} vars</span>
      </div>
      {entries.length === 0 ? (
        <div className="insp-empty">
          Sin definiciones aún — prueba <code>a=2</code> en una celda
        </div>
      ) : (
        <table className="scope-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Value</th>
              <th>Dim</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([sym, val]) => (
              <tr key={sym}>
                <td className="sym">{sym}</td>
                <td>{val}</td>
                <td className="dim">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {functions.length > 0 && (
        <>
          <div className="insp-title-row">
            <span className="insp-title">Funciones</span>
          </div>
          <div className="fn-chips">
            {functions.map((f) => (
              <span key={f} className="fn-chip">
                {f}(…)
              </span>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

// ── Statusbar ────────────────────────────────────────────────────────────
export function StatusBar({ engineText }: { engineText: string }) {
  const cells = useDoc((s) => s.cells);
  const definitions = useDoc((s) => s.definitions);
  return (
    <footer className="statusbar">
      <span className="sb-engine">{engineText}</span>
      <span className="sb-mid">
        {cells.length} celdas · {Object.keys(definitions).length} variables definidas
      </span>
      <span className="sb-hint">
        Fase 1 · variables encadenadas · f(x):=… · paleta ← inserta en la fórmula focuseada
      </span>
    </footer>
  );
}
