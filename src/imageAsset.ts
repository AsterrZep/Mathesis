// imageAsset.ts — pipeline de imágenes del documento (Fase 2)
//
// Método optimizado:
// 1. DEDUP por SHA-256 (id = hash[:16]) → la misma imagen insertada N veces
//    se guarda UNA vez en doc.assets y las celdas solo referencian el id.
// 2. Compresión selectiva: solo si >300 KB se re-enctype a WebP (máx
//    MAX_DIM px, calidad WEBP_Q) y SOLO si mejora ≥15%; GIF/SVG se
//    conservan tal cual (animación/vectores).
// 3. base64 SIN prefijo "data:" en el JSON (mime aparte).
// 4. GC al guardar: solo los assets referenciados por celdas viajan al disco.

/** Asset embebido en el documento: data = base64 puro (sin data:…;) */
export interface DocAsset {
  mime: string;
  bytes: number;
  data: string;
}

const MAX_DIM = 1920;
const WEBP_Q = 0.85;
const COMPRESS_THRESHOLD = 300_000; // bytes
const MIN_GAIN = 0.85;              // solo si el nuevo pesa <85 % del original

/** Uint8Array → base64 por chunks (sin desbordar el stack con String.fromCharCode) */
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/** base64 → Uint8Array */
export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SHA-256 → hex[:16] (fallback FNV-1a si no hay crypto.subtle) */
export async function contentId(bytes: Uint8Array): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Fallback determinista (dev sin contexto seguro)
    let h = 0x811c9dc5;
    for (const b of bytes) {
      h ^= b;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }
}

/**
 * Compresión selectiva: re-enctype a WebP solo si merece la pena.
 * Devuelve los bytes finales y su mime.
 */
async function maybeCompress(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  // Conservar formatos que perderían propiedades (animación, vectores)
  if (mime === "image/gif" || mime === "image/svg+xml") return { bytes, mime };
  if (bytes.length <= COMPRESS_THRESHOLD) return { bytes, mime };

  try {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return { bytes, mime };
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const out = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/webp", WEBP_Q),
    );
    if (!out) return { bytes, mime }; // webp no soportado → original
    const nb = new Uint8Array(await out.arrayBuffer());
    if (nb.length < bytes.length * MIN_GAIN) {
      return { bytes: nb, mime: "image/webp" };
    }
    return { bytes, mime }; // no mejoró lo suficiente → original
  } catch {
    return { bytes, mime }; // decodificación fallida → original
  }
}

export interface IngestResult {
  id: string;
  asset: DocAsset;
  /** true si el archivo ya existía en el registro (dedup) */
  dedup: boolean;
}

/**
 * File → asset del documento (hash → dedup → compresión selectiva → base64).
 * `exists` permite saltar el transcode si el id ya está registrado.
 */
export async function ingestImage(
  file: File,
  exists: (id: string) => boolean,
): Promise<IngestResult> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime0 = file.type || "image/png";
  const id = await contentId(raw);
  if (exists(id)) {
    return { id, asset: { mime: mime0, bytes: raw.length, data: "" }, dedup: true };
  }
  const { bytes, mime } = await maybeCompress(raw, mime0);
  return {
    id,
    asset: { mime, bytes: bytes.length, data: toBase64(bytes) },
    dedup: false,
  };
}

/** data URL para <img> (se memoiza en memoria del módulo por asset) */
const urlCache = new Map<string, string>();
export function assetUrl(id: string, a: DocAsset): string {
  let u = urlCache.get(id);
  if (!u) {
    u = `data:${a.mime};base64,${a.data}`;
    urlCache.set(id, u);
  }
  return u;
}
