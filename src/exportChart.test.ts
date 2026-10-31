// Tests de exportación de figuras (SVG desde datos + helpers).

import { describe, expect, it } from "vitest";
import {
  chartToSVG,
  legendLabel,
  niceTicks,
  xmlEscape,
} from "./exportChart";

const spec = () => ({
  x: [0, 1, 2, 3, 4],
  series: [
    { id: String.raw`\sin(x)`, y: [0, 1, null, -1, 0] },
    { id: "x^2", y: [0, 1, 4, 9, 16] },
  ],
  width: 640,
  height: 400,
  subtitle: "x ∈ [0, 4] · 5 pts",
});

describe("exportChart — helpers", () => {
  it("niceTicks genera múltiplos 1/2/5×10^n dentro del rango", () => {
    const t = niceTicks(0, 10, 6);
    expect(t.length).toBeGreaterThan(2);
    expect(t[0]).toBeGreaterThanOrEqual(0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(10 + 1e-9);
    expect(niceTicks(-1, 1, 5)).toContain(0);
    // degenerado → no bucle infinito
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it("xmlEscape y legendLabel (LaTeX legible)", () => {
    expect(xmlEscape('<a & "b">')).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    expect(legendLabel(String.raw`\sin(x)`)).toBe("sin(x)");
    expect(legendLabel("un nombre de función larguísimoxxxxxxxx")).toHaveLength(25);
  });
});

describe("exportChart — chartToSVG", () => {
  const svg = chartToSVG(spec());

  it("es SVG bien formado con dimensiones (WebKit lo exige para rasterizar)", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="400"');
    expect(svg).toContain('viewBox="0 0 640 400"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("dibuja 3 polilíneas: serie1 partida por el gap (null) + serie2", () => {
    const polylines = svg.match(/<polyline /g) ?? [];
    expect(polylines).toHaveLength(3);
    // La serie con gap NO debe contener 'NaN' en points
    expect(svg).not.toContain("NaN");
  });

  it("leyenda con etiqueta sin LaTeX y escapada", () => {
    expect(svg).toContain("sin(x)");
    expect(svg).toContain("x^2");
    expect(svg).not.toContain("\\sin"); // backslash fuera del label
  });

  it("rejilla, ejes, ticks y subtítulo", () => {
    expect(svg).toContain(`stroke="#424751"`); // grid
    expect(svg).toContain("x ∈ [0, 4] · 5 pts"); // subtitle escapado tal cual
    expect((svg.match(/<text /g) ?? []).length).toBeGreaterThan(6); // labels
  });

  it("valores todos nulos → dominio por defecto (sin crash ni ∞)", () => {
    const s = chartToSVG({ x: [0, 1], series: [{ id: "e", y: [null, null] }] });
    expect(s).toContain("<svg");
    expect(s).not.toContain("Infinity");
    expect(s).not.toContain("NaN");
  });

  it("título de serie con < & se escapa (XML válido)", () => {
    const s = chartToSVG({
      x: [0, 1],
      series: [{ id: "a<b>&c", y: [1, 2] }],
    });
    expect(s).toContain("a&lt;b&gt;&amp;c");
    expect(s).not.toMatch(/<text[^>]*>[^<]*a<b/);
  });
});
