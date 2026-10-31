// Paridad de claves ES/EN (i18next) — protege contra traducciones a medias.

import { describe, expect, it } from "vitest";
import { es } from "./locales/es";
import { en } from "./locales/en";

type AnyDict = Record<string, unknown>;

const keys = (obj: AnyDict, prefix = ""): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? keys(v as AnyDict, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );

describe("i18n — paridad ES/EN", () => {
  it("en tiene exactamente las mismas claves que es (recursivo)", () => {
    expect(keys(en as unknown as AnyDict).sort()).toEqual(
      keys(es as unknown as AnyDict).sort(),
    );
  });

  it("sin valores vacíos ni claves sobrantes", () => {
    for (const dict of [es as unknown as AnyDict, en as unknown as AnyDict]) {
      for (const k of keys(dict)) {
        const val = k.split(".").reduce<unknown>((acc, part) => {
          if (typeof acc !== "object" || acc === null) return undefined;
          return (acc as AnyDict)[part];
        }, dict);
        expect(typeof val, k).toBe("string");
        expect((val as string).trim().length, k).toBeGreaterThan(0);
      }
    }
  });

  it("las interpolaciones coinciden entre idiomas ({{n}}, {{msg}}…)", () => {
    const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join(",");
    const walk = (a: AnyDict, b: AnyDict, prefix = ""): void => {
      for (const k of Object.keys(a)) {
        const av = a[k];
        const bv = b[k];
        if (typeof av === "string") {
          expect(vars(av as string), `${prefix}${k}`).toBe(
            vars(bv as string),
          );
        } else if (typeof av === "object" && av !== null) {
          walk(av as AnyDict, bv as AnyDict, `${prefix}${k}.`);
        }
      }
    };
    walk(es as unknown as AnyDict, en as unknown as AnyDict);
  });
});
