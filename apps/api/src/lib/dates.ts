/** Hilfsfunktionen für Kalenderdaten im Format YYYY-MM-DD (ohne Zeitzonen). */

export type IsoDate = string;

export function todayIso(now = new Date()): IsoDate {
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

function parse(d: IsoDate): Date {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day));
}

function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/**
 * Addiert Monate kalendergenau. Fehlt der Tag im Zielmonat (z. B. 31.), wird der Monatsletzte
 * genommen (entspricht § 188 Abs. 3 BGB).
 */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const date = parse(d);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toIso(target);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const date = parse(d);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000);
}
