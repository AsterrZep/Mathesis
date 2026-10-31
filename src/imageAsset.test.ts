// Tests del pipeline de imágenes: base64, hash/dedup y registro del store.

import { describe, expect, it } from "vitest";
import {
  contentId,
  fromBase64,
  ingestImage,
  toBase64,
} from "./imageAsset";
import { insertImageFile, replaceImageCell, useDoc, usedAssets } from "./store";

const bytesOf = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe("imageAsset — codificación e identidad", () => {
  it("toBase64/fromBase64 roundtrip (incluido >64KB, chunks)", () => {
    const big = bytesOf(200_000, 42);
    const b64 = toBase64(big);
    expect(b64.length).toBeGreaterThan(100_000);
    const back = fromBase64(b64);
    expect(back.length).toBe(big.length);
    expect(back[0]).toBe(42);
    expect(back[back.length - 1]).toBe(42);
  });

  it("contentId es determinista y distinto para contenido distinto", async () => {
    const a = await contentId(bytesOf(1000, 1));
    const b = await contentId(bytesOf(1000, 1));
    const c = await contentId(bytesOf(1000, 2));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{8,16}$/);
  });
});

describe("imageAsset — ingestImage (dedup + sin compresión de ficheros pequeños)", () => {
  const smallFile = () =>
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], "a.png", {
      type: "image/png",
    });

  it("fichero pequeño: se conserva tal cual (sin canvas/webp)", async () => {
    const r = await ingestImage(smallFile(), () => false);
    expect(r.dedup).toBe(false);
    expect(r.asset.mime).toBe("image/png");
    expect(r.asset.bytes).toBe(11);
    // data es base64 válido del contenido original
    expect(fromBase64(r.asset.data).length).toBe(11);
  });

  it("dedup: si el id ya existe no se vuelve a comprimir (data vacía)", async () => {
    const r = await ingestImage(smallFile(), () => true);
    expect(r.dedup).toBe(true);
    expect(r.asset.data).toBe("");
  });
});

describe("store — celdas de imagen (registro, GC, reemplazo)", () => {
  const asset = (n: number) => ({
    mime: "image/png",
    bytes: 10,
    data: toBase64(bytesOf(10, n)),
  });

  it("insertImageFile crea celda image y registra el asset (dedup en 2ª)", async () => {
    useDoc.getState().newDoc();
    const before = useDoc.getState().cells.length;
    await insertImageFile(new File([bytesOf(10, 9)], "x.png", { type: "image/png" }), 0);
    const s = useDoc.getState();
    expect(s.cells.length).toBe(before + 1);
    const cell = s.cells[1];
    expect(cell.type).toBe("image");
    expect(cell.assetId).toBeTruthy();
    expect(Object.keys(s.assets)).toHaveLength(1);
    expect(s.assets[cell.assetId!].data.length).toBeGreaterThan(0);
  });

  it("usedAssets hace GC: solo los referenciados viajan al disco", () => {
    useDoc.getState().newDoc();
    const cells = useDoc.getState().cells;
    useDoc.getState().putAsset("used", asset(1));
    useDoc.getState().putAsset("orphan", asset(2));
    useDoc.getState().addImage(0, "used", asset(1));
    const doc = usedAssets(useDoc.getState().cells, useDoc.getState().assets);
    expect(Object.keys(doc)).toEqual(["used"]);
    expect(Object.keys(doc).some((k) => k === "orphan")).toBe(false);
    expect(cells.length).toBeGreaterThan(0);
  });

  it("replaceImageCell cambia el assetId de la celda", async () => {
    useDoc.getState().newDoc();
    await insertImageFile(new File([bytesOf(12, 3)], "one.png", { type: "image/png" }), 0);
    const cellId = useDoc.getState().cells[1].id;
    const oldId = useDoc.getState().cells[1].assetId;
    await replaceImageCell(
      cellId,
      new File([bytesOf(14, 5)], "two.png", { type: "image/png" }),
    );
    const cell = useDoc.getState().cells[1];
    expect(cell.assetId).not.toBe(oldId);
    expect(Object.keys(useDoc.getState().assets)).toHaveLength(2); // el viejo queda (GC en save)
  });

  it("loadDoc restaura assets y celdas image", () => {
    useDoc.getState().loadDoc("/tmp/i.math.json", {
      version: 1,
      title: "i",
      assets: { a1: asset(4) },
      cells: [
        { id: "orig", type: "image", latex: "", assetId: "a1" },
        { id: "m", type: "math", latex: "2+2" },
      ],
    });
    const s = useDoc.getState();
    expect(s.assets.a1.bytes).toBe(10);
    const img = s.cells.find((c) => c.type === "image");
    expect(img?.assetId).toBe("a1");
    expect(img?.id).not.toBe("orig"); // ids regenerados para remontaje
  });
});
