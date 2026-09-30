import { createRoute } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { documents } from "../../db/schema.js";
import { ErrorResponse } from "../../lib/errors.js";
import { createRouter, UuidParam } from "../../lib/http.js";

const download = createRoute({
  method: "get",
  path: "/documents/{id}/file",
  operationId: "downloadDocument",
  tags: ["Dokumente"],
  summary: "Datei eines Dokuments aus der Ablage laden (lokal/Nextcloud; URLs werden umgeleitet)",
  "x-mcp": false,
  request: { params: UuidParam },
  responses: {
    200: { description: "Datei" },
    302: { description: "Umleitung auf externe URL" },
    404: {
      description: "Nicht gefunden",
      content: { "application/json": { schema: ErrorResponse } },
    },
    422: {
      description: "Nicht abrufbar",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

export const documentsRouter = createRouter().openapi(download, async (c) => {
  const [doc] = await c
    .get("db")
    .select()
    .from(documents)
    .where(eq(documents.id, c.req.valid("param").id));
  if (!doc) return c.json({ error: "not_found", message: "Dokument nicht gefunden" }, 404);
  if (doc.storage === "url") return c.redirect(doc.location, 302);
  const storage = c.get("services").storage;
  if (doc.storage !== storage.kind) {
    return c.json(
      { error: "unprocessable", message: `Ablage "${doc.storage}" ist hier nicht angebunden` },
      422,
    );
  }
  const bytes = await storage.get(doc.location);
  const name = doc.location.split("/").pop() ?? "datei";
  return c.body(Buffer.from(bytes), 200, {
    "content-type": doc.mimeType ?? "application/octet-stream",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
    "cache-control": "private, max-age=3600",
  });
});
