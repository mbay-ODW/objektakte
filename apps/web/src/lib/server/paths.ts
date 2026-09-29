/** Ohne Anmeldung erreichbar: Login, statische Dateien der PWA, Lebenszeichen. */
const PUBLIC_EXACT = new Set([
  "/login",
  "/health",
  "/manifest.webmanifest",
  "/icon.svg",
  "/service-worker.js",
  "/robots.txt",
]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_EXACT.has(path) || path.startsWith("/_app/") || path.startsWith("/login/");
}

/** Pfade, die Daten liefern: ohne Sitzung 401 statt Umleitung auf die Anmeldung. */
export function isDataPath(path: string): boolean {
  return path.startsWith("/api-proxy/") || path.startsWith("/dokumente/");
}
