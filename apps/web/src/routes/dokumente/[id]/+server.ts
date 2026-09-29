import { error, redirect } from "@sveltejs/kit";
import { webEnv } from "$lib/server/env";
import type { RequestHandler } from "./$types";

/** Datei eines Dokuments über die API laden, ohne das API-Token preiszugeben. */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) error(400, "Ungültige Dokument-ID");
  const env = webEnv();
  let upstream: Response;
  try {
    upstream = await fetch(`${env.apiUrl}/api/v1/documents/${params.id}/file`, {
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
  const headers = new Headers({ "cache-control": "private, max-age=3600" });
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) {
    headers.set(
      "content-disposition",
      url.searchParams.has("download") ? disposition.replace(/^inline/, "attachment") : disposition,
    );
  }
  // HTML-Protokolle nicht im Kontext der Anwendung ausführen lassen.
  headers.set(
    "content-security-policy",
    "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
  );
  return new Response(upstream.body, { status: 200, headers });
};
