/** Fotos vor dem Speichern verkleinern: JPEG, längste Kante max. 1600 px, Qualität ~0,8. */

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.8;

/** Zielgröße unter Beibehaltung des Seitenverhältnisses; vergrößert nie. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressImage(
  file: Blob,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? MAX_EDGE;
  const quality = options.quality ?? JPEG_QUALITY;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas nicht verfügbar");
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: "image/jpeg", quality });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nicht verfügbar");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Bild konnte nicht umgewandelt werden"))),
        "image/jpeg",
        quality,
      ),
    );
  } finally {
    bitmap.close();
  }
}
