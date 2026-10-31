// components.tsx — componentes de layout estilo Stitch (ver
// Documentacion/07-diseno/): topbar, paleta de símbolos, celdas,
// inspector de scope, statusbar.

import { useState } from "react";
import { useDoc, type Cell } from "./store";
import { MathField } from "./MathField";
import { insertIntoActive } from "./mathfield-registry";

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

// ── Inspector derecho (scope symbols + placeholder de gráficos) ───────────
export function Inspector() {
  const definitions = useDoc((s) => s.definitions);
  const functions = useDoc((s) => s.functions);
  const entries = Object.entries(definitions);
  return (
    <aside className="inspector">
      <div className="insp-title-row">
        <span className="insp-title">⌗ Interactive Phase Plot</span>
        <span className="insp-badge">uPlot · Fase 1+</span>
      </div>
      <div className="plot-placeholder">
        <div className="ph-icon">📈</div>
        <div>
          Los gráficos llegan con <b>plot_data</b>:
          <br />
          Julia malla de puntos → canvas uPlot
          <br />
          (zoom/pan local, sin roundtrip)
        </div>
      </div>
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
