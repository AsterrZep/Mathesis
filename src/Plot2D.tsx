// Plot2D.tsx — lienzo uPlot multi-serie para las celdas de gráfico.
//
// Datos de Julia (plot_data): x[], series[{id, y[]}] — null en y = gap
// (dominio inválido, p.ej. √x para x<0) y se pasa a NaN, que uPlot salta
// nativamente. Zoom/pan locales sin roundtrip (ADR-003): arrastrar = zoom
// en x, doble clic = reset.

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const COLORS = ["#6ea8fe", "#ff6b6b", "#ffd166", "#06d6a0", "#c084fc"];

export interface PlotSeries {
  id: string;
  y: (number | null)[];
}

interface Props {
  x: number[];
  series: PlotSeries[];
  height?: number;
}

export function Plot2D({ x, series, height = 240 }: Props) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || series.length === 0) return;
    const axisFont = '10px "JetBrains Mono", monospace';
    const opts: uPlot.Options = {
      width: el.clientWidth || 480,
      height,
      legend: { show: true },
      cursor: { drag: { x: true, y: false }, focus: { prox: 24 } },
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
      series: [
        {},
        ...series.map((s, i) => ({
          label: s.id,
          stroke: COLORS[i % COLORS.length],
          width: 2,
          points: { show: false },
        })),
      ],
    };
    const data = [
      x,
      ...series.map((s) => s.y.map((v) => (v === null ? NaN : v))),
    ] as unknown as uPlot.AlignedData;
    const p = new uPlot(opts, data, el);
    const ro = new ResizeObserver(() =>
      p.setSize({ width: el.clientWidth || 480, height }),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      p.destroy();
    };
  }, [x, series, height]);

  return <div ref={host} className="plot2d-canvas" />;
}
