/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

/**
 * Service Worker der PWA „Vor Ort“.
 * - App-Shell (Build-Dateien, statische Dateien): Cache zuerst.
 * - Vor-Ort-Seite: Netz zuerst, bei fehlender Verbindung aus dem Cache.
 * - Lesende API-Aufrufe über /api-proxy und Dokumente: Netz zuerst, Cache als Rückfall.
 * - Schreibende Aufrufe laufen nie über den Cache (dafür gibt es die IndexedDB-Warteschlange).
 */
import { build, files, version } from "$service-worker";

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = `objektakte-shell-${version}`;
const DATA_CACHE = "objektakte-data-v1";
const SHELL = [...build, ...files];
const SHELL_SET = new Set(SHELL);
const VOR_ORT = "/vor-ort";

async function cacheVorOrtPage(cache: Cache) {
  try {
    const res = await fetch(VOR_ORT, { credentials: "same-origin" });
    // Nur die echte Seite speichern, nicht die Umleitung auf die Anmeldung.
    if (res.ok && !res.redirected) await cache.put(VOR_ORT, res);
  } catch {
    // offline: Seite wird beim nächsten Aufruf gespeichert
  }
}

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL);
      await cacheVorOrtPage(cache);
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== SHELL_CACHE && key !== DATA_CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function networkFirst(
  request: Request,
  cacheName: string,
  key: string | Request = request,
  ignoreSearch = false,
): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected && res.type === "basic") await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch });
    if (hit) return hit;
    throw err;
  }
}

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;

  if (SHELL_SET.has(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (
    request.mode === "navigate" &&
    (url.pathname === VOR_ORT || url.pathname.startsWith(`${VOR_ORT}/`))
  ) {
    // Alle Vor-Ort-Ansichten teilen sich dieselbe clientseitig gerenderte Seite.
    event.respondWith(networkFirst(request, SHELL_CACHE, VOR_ORT, true));
    return;
  }
  if (url.pathname.startsWith("/api-proxy/") || url.pathname.startsWith("/dokumente/")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});
