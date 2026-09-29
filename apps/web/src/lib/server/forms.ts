/** Hilfen zum Auslesen von FormData in Form-Actions. */

/** Getrimmter Text oder null bei leerem Feld. */
export function text(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** Getrimmter Text oder undefined (Feld wird bei PATCH nicht übertragen). */
export function optText(fd: FormData, name: string): string | undefined {
  return text(fd, name) ?? undefined;
}

export function int(fd: FormData, name: string): number | null {
  const t = text(fd, name);
  if (t === null) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

/** Dezimalzahl, deutsches Komma erlaubt. */
export function num(fd: FormData, name: string): number | null {
  const t = text(fd, name);
  if (t === null) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Eurobetrag ("1.234,56") in Cent. */
export function cents(fd: FormData, name: string): number | null {
  const n = num(fd, name);
  return n === null ? null : Math.round(n * 100);
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}

/** Zeilenweise Liste (leere Zeilen entfallen). */
export function lines(fd: FormData, name: string): string[] {
  const v = fd.get(name);
  if (typeof v !== "string") return [];
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Alle Plain-Werte eines Formulars (für das Wiederbefüllen nach Fehlern). */
export function values(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
  return out;
}
