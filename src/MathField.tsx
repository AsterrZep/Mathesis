// MathField.tsx — editor matemático 2D con MathLive (montaje imperativo).
//
// Se crea el <math-field> vía new MathfieldElement() en vez de JSX para
// evitar declarar intrinsic elements y mantener tipado completo.
//
// IMPORTANTE: emitimos el LaTeX, NO getValue('math-json'). El MathJSON
// "default" de compute-engine EVALÚA constantes (1/0 → "NaN" literal,
// 1/3 → ["Rational",…]) destruyendo el AST que Julia debe evaluar
// (ver mejora M-2 en Documentacion/04-plan/fases.md). El parse con
// canonical:false se hace en App.tsx tras el debounce.

import { useEffect, useRef } from "react";
import { MathfieldElement } from "mathlive";
import "@cortex-js/compute-engine";
// Fuentes oficiales de MathLive resueltas por Vite (evita el NetworkError
// de su cargador dinámico por defecto en dev/bundling)
import "mathlive/fonts.css";

interface Props {
  /** LaTeX inicial */
  initial?: string;
  /** Se dispara con el LaTeX actual en cada edición */
  onChange: (latex: string) => void;
}

export function MathField({ initial = "2+2", onChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  // Ref para no re-registrar el listener si onChange cambia de identidad
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const mf = new MathfieldElement();
    mf.value = initial;
    mf.classList.add("mf");

    // ── M-1 (sombreado): variables de MathLive entregadas INLINE por JS ──
    // Por si el selector CSS externo no alcanzara el elemento/estado. Usa
    // rgba (soportado por todo) en vez de color-mix. Ver M-1 en 04-plan/fases.md.
    mf.style.setProperty("--selection-background-color", "rgba(110,168,254,0.30)");
    mf.style.setProperty("--selection-color", "#e8eaf2");
    mf.style.setProperty("--caret-color", "#6ea8fe");
    // CULPTE REAL del "sombreado blanco" (overlay de diagnóstico M-1):
    // .ML__focused .ML__contains-highlight pinta el grupo bajo el cursor
    // (p.ej. dentro de paréntesis) con hsl(212,40%,95%) ≈ casi blanco.
    mf.style.setProperty(
      "--contains-highlight-background-color",
      "rgba(110,168,254,0.30)",
    );
    // Defensa en profundidad: hoja dentro del shadow DOM de MathLive
    // (raíz abierta). Con la MISMA especificidad que la regla interna pero
    // después en orden → gana; cubre también ::selection nativo de WebKit.
    try {
      const sr = mf.shadowRoot;
      if (!sr) throw new Error("shadowRoot no disponible");
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        :host(:focus) .ML__selection {
          background: var(--selection-background-color,
            rgba(110, 168, 254, 0.30)) !important;
        }
        .ML__focused .ML__contains-highlight {
          background: var(--contains-highlight-background-color,
            rgba(110, 168, 254, 0.30)) !important;
        }
        ::selection {
          background: rgba(110, 168, 254, 0.35) !important;
          color: #e8eaf2 !important;
        }
      `);
      sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, sheet];
    } catch (e) {
      console.warn("shadow sheet fallback", e);
    }

    const emit = () => cb.current(mf.getValue("latex"));
    mf.addEventListener("input", emit);

    host.current.appendChild(mf);
    emit(); // evaluación inicial (ej. "2+2" al cargar)

    return () => {
      mf.removeEventListener("input", emit);
      mf.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="mathfield-host" />;
}
