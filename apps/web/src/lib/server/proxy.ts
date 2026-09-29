/** Regeln des API-Proxys für Browser-Aufrufe (PWA „Vor Ort“). */

/** Header, den eigene Client-Aufrufe setzen müssen (erzwingt bei Fremd-Origins einen Preflight). */
export const CLIENT_HEADER = "x-objektakte-client";

/** Nur einfache Pfadsegmente zulassen, damit der Proxy nichts außerhalb von /api/v1 erreicht. */
export function safeApiPath(path: string): string | null {
  if (path === "" || path.length > 500) return null;
  const segments = path.split("/");
  for (const s of segments) {
    if (!/^[A-Za-z0-9_\-.:ÄÖÜäöü%]+$/.test(s) || s === "." || s === "..") return null;
    if (/%2f|%5c|%2e/i.test(s)) return null;
  }
  return segments.join("/");
}

/**
 * CSRF-Schutz: Aufrufe müssen den eigenen Header tragen und – sofern der Browser Herkunftsangaben
 * sendet – von derselben Origin stammen.
 */
export function checkCsrf(request: Request, origin: string): string | null {
  if (request.headers.get(CLIENT_HEADER) !== "1") return "Client-Header fehlt";
  const requestOrigin = request.headers.get("origin");
  if (requestOrigin && requestOrigin !== origin) return "Fremde Origin";
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "Keine Same-Origin-Anfrage";
  return null;
}

/** Antwort-Header, die an den Browser weitergegeben werden. */
export const PASSTHROUGH_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "content-length",
  "cache-control",
  "location",
];
