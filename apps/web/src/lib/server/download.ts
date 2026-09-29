import { error, redirect } from "@sveltejs/kit";
import { webEnv } from "./env";

/**
 * Lädt eine Datei (PDF, XML, CSV, ZIP …) von der API und reicht sie an den Browser weiter,
 * ohne das API-Token preiszugeben. `apiPath` ist relativ zu /api/v1.
 */
export async function passThroughFile(
  apiPath: string,
  options: { attachment?: boolean; filename?: string } = {},
): Promise<Response> {
  const env = webEnv();
  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiUrl}/api/v1/${apiPath}`, {
      headers: { authorization: `Bearer ${env.apiToken}` },
      redirect: "manual",
    });
  } catch {
    error(502, "API nicht erreichbar");
  }
  if (upstream.status === 302) {
    const location = upstream.headers.get("location");
    if (location && /^https?:\/\//.test(location)) redirect(302, location);
    error(502, "Ungültige Umleitung");
  }
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    error(upstream.status, body?.message ?? "Datei nicht abrufbar");
  }
  const headers = new Headers({ "cache-control": "private, no-store" });
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  let disposition = upstream.headers.get("content-disposition");
  if (options.filename) {
    disposition = `inline; filename*=UTF-8''${encodeURIComponent(options.filename)}`;
  }
  if (disposition) {
    headers.set(
      "content-disposition",
      options.attachment ? disposition.replace(/^inline/, "attachment") : disposition,
    );
  }
  // Heruntergeladene HTML-/XML-Dateien nicht im Kontext der Anwendung ausführen lassen.
  headers.set(
    "content-security-policy",
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  );
  return new Response(upstream.body, { status: 200, headers });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
