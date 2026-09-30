import { createRoute } from "@hono/zod-openapi";
import { createRouter, ValidationError } from "../../lib/http.js";
import { ImportBatch, ImportErrorResponse, ImportResult } from "./schema.js";
import { ImportFailed, runImport } from "./service.js";

const importRoute = createRoute({
  method: "post",
  path: "/import",
  tags: ["Import"],
  summary: "Datenbestand im neutralen Austauschformat importieren (idempotent, atomar)",
  request: {
    body: { required: true, content: { "application/json": { schema: ImportBatch } } },
  },
  responses: {
    200: {
      description: "Import ausgeführt",
      content: { "application/json": { schema: ImportResult } },
    },
    400: {
      description: "Ungültiges Format",
      content: { "application/json": { schema: ValidationError } },
    },
    422: {
      description: "Import zurückgerollt (z. B. unbekannte Referenzen)",
      content: { "application/json": { schema: ImportErrorResponse } },
    },
  },
});

export const importRouter = createRouter().openapi(importRoute, async (c) => {
  const batch = c.req.valid("json");
  try {
    const result = await runImport(c.get("db"), batch, c.get("actor"));
    return c.json(result, 200);
  } catch (err) {
    if (err instanceof ImportFailed) {
      return c.json({ error: "import_failed" as const, problems: err.problems }, 422);
    }
    throw err;
  }
});
