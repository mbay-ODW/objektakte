/** Ermittelt die tatsächlich geänderten Felder (für Ereignis-Payloads). */
export function changes(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    const from = before[key];
    if (norm(from) !== norm(to)) out[key] = { from: from ?? null, to: to ?? null };
  }
  return out;
}

function norm(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v));
  if (typeof v === "number") return String(v);
  return JSON.stringify(v);
}

/** Entfernt undefined-Werte (PATCH-Semantik: nicht übergeben = nicht ändern). */
export function defined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
