// exportChart.ts — Exportación de FIGURAS PNG/SVG (Fase 2)
//
// Decisión de rendimiento (revisión ligera de ADR-003): NO se empaqueta
// CairoMakie en el engine (≈200-400 MB extra de sysimage, arranque y RSS más
// altos — crítico en equipos de pocos recursos) — las figuras se exportan
// desde los MISMOS datos de plot_data con un renderer SVG propio:
//   · SVG = XML de polilíneas + ejes + rejilla + leyenda (cero dependencias)
//   · PNG = rasterizado del SVG a 2× (nítido; un solo renderer = coherente)
// CairoMakie queda para Fase 4 si se necesita export headless (medir antes).

export interface ChartSeries {
  id: string;
  /** null = gap (fuera de dominio) → separa polilíneas */
  y: (number | null)[];
}

export interface ChartSpec {
  x: number[];
  series: ChartSeries[];
  width?: number;
  height?: number;
  /** rótulo bajo el eje x, p.ej. "x ∈ [-6.28, 6.28] · 400 pts" */
  subtitle?: string;
}

export const CHART_COLORS = ["#6ea8fe", "#ff6b6b", "#ffd166", "#06d6a0", "#c084fc"];

const BG = "#1d1f26";
const GRID = "#424751";
const AXIS = "#8c919d";
const FG = "#c2c6d3";

/** Escapes XML para etiquetas (la serie trae LaTeX: \sin(x)…) */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Etiqueta de leyenda legible: sin comandos LaTeX (\sin → sin) */
export function legendLabel(id: string): string {
  const t = id.replace(/\\/g, "").replace(/[{}]/g, "");
  return t.length > 24 ? t.slice(0, 24) + "…" : t;
}

/** Ticks "bonitos" (múltiplos 1/2/5×10^n) — algoritmo clásico. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [Number.isFinite(min) ? min : 0];
  }
  const span = max - min;
  const step0 = span / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return out;
}

const fmt = (v: number): string => {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(1);
  return String(Number(v.toPrecision(6)));
};

/** ChartSpec → SVG (string listo para archivo o rasterizar). */
export function chartToSVG(spec: ChartSpec): string {
  const W = spec.width ?? 640;
  const H = spec.height ?? 400;
  const M = { l: 52, r: 14, t: 14, b: spec.subtitle ? 42 : 26 };
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;

  // Dominios: x del rango muestreado; y de los valores finitos
  const xs = spec.x;
  const x0 = xs.length > 0 ? xs[0] : 0;
  const x1 = xs.length > 0 ? xs[xs.length - 1] : 1;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const s of spec.series) {
    for (const v of s.y) {
      if (v !== null && Number.isFinite(v)) {
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
  }
  if (!Number.isFinite(ymin) || !Number.isFinite(ymax)) {
    ymin = -1;
    ymax = 1;
  }
  if (ymin === ymax) {
    ymin -= 1;
    ymax += 1;
  }
  const pad = (ymax - ymin) * 0.05;
  ymin -= pad;
  ymax += pad;

  const px = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * plotW;
  const py = (y: number) => M.t + plotH - ((y - ymin) / (ymax - ymin)) * plotH;

  const xTicks = niceTicks(x0, x1, 7);
  const yTicks = niceTicks(ymin, ymax, 6);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="JetBrains Mono, ui-monospace, monospace">`,
  );
  parts.push(`<rect width="${W}" height="${H}" fill="${BG}"/>`);

  // Rejilla + eje Y (ticks)
  for (const t of yTicks) {
    const y = py(t);
    if (y < M.t - 0.5 || y > M.t + plotH + 0.5) continue;
    parts.push(
      `<line x1="${M.l}" y1="${y.toFixed(1)}" x2="${W - M.r}" y2="${y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${M.l - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${AXIS}">${fmt(t)}</text>`,
    );
  }
  // Eje X (ticks + rejilla vertical)
  for (const t of xTicks) {
    const x = px(t);
    if (x < M.l - 0.5 || x > M.l + plotW + 0.5) continue;
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${M.t}" x2="${x.toFixed(1)}" y2="${M.t + plotH}" stroke="${GRID}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x.toFixed(1)}" y="${M.t + plotH + 14}" text-anchor="middle" font-size="10" fill="${AXIS}">${fmt(t)}</text>`,
    );
  }
  // Marco
  parts.push(
    `<rect x="${M.l}" y="${M.t}" width="${plotW}" height="${plotH}" fill="none" stroke="${AXIS}" stroke-width="1"/>`,
  );

  // Series: polilíneas segmentadas en los gaps (null → corte)
  spec.series.forEach((s, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    let seg: string[] = [];
    const flush = () => {
      if (seg.length >= 2) {
        parts.push(
          `<polyline points="${seg.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
      seg = [];
    };
    for (let k = 0; k < xs.length && k < s.y.length; k++) {
      const v = s.y[k];
      if (v === null || !Number.isFinite(v)) {
        flush();
        continue;
      }
      seg.push(`${px(xs[k]).toFixed(1)},${py(v).toFixed(1)}`);
    }
    flush();
  });

  // Leyenda (si hay sitio sin tapar la curva: esquina superior derecha)
  if (spec.series.length > 0 && plotW > 140) {
    const items = spec.series.map(
      (s, i) =>
        `<rect x="0" y="${i * 15}" width="9" height="9" rx="2" fill="${CHART_COLORS[i % CHART_COLORS.length]}"/><text x="13" y="${i * 15 + 8}" font-size="10" fill="${FG}">${xmlEscape(legendLabel(s.id))}</text>`,
    );
    const legendW = Math.max(
      ...spec.series.map((s) => legendLabel(s.id).length * 6.2 + 22),
      30,
    );
    const lx = W - M.r - legendW - 6;
    parts.push(
      `<g transform="translate(${lx}, ${M.t + 6})"><rect x="-4" y="-4" width="${legendW}" height="${spec.series.length * 15 + 6}" rx="4" fill="${BG}" fill-opacity="0.82" stroke="${GRID}"/>${items.join("")}</g>`,
    );
  }

  if (spec.subtitle) {
    parts.push(
      `<text x="${M.l}" y="${H - 8}" font-size="10" fill="${AXIS}">${xmlEscape(spec.subtitle)}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

/**
 * SVG → PNG dataURL (sin prefijo) a escala 2× — rasterizado en el webview.
 * El SVG lleva width/height explícitos (WebKit lo exige para decodificar).
 */
export function svgToPngB64(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d no disponible");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo rasterizar el SVG"));
    };
    img.src = url;
  });
}
