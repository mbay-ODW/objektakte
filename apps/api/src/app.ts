import { timingSafeEqual } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Services } from "./adapters/index.js";
import type { Database } from "./db/client.js";
import { DomainError, errorCode } from "./lib/errors.js";
import type { AppEnv } from "./lib/http.js";
import { billingRouter } from "./modules/billing/routes.js";
import { casesRouter } from "./modules/cases/routes.js";
import { communicationsRouter } from "./modules/communications/routes.js";
import { contactsRouter } from "./modules/contacts/routes.js";
import { documentsRouter } from "./modules/documents/routes.js";
import { fundingRouter } from "./modules/funding/routes.js";
import { importRouter } from "./modules/import/routes.js";
import { inspectionsRouter } from "./modules/inspections/routes.js";
import { createMcpHandler } from "./modules/mcp/server.js";
import type { OpenApiDocument } from "./modules/mcp/tools.js";
import { objectsRouter } from "./modules/objects/routes.js";
import { paymentsRouter } from "./modules/payments/routes.js";
import { reportsRouter } from "./modules/reports/routes.js";
import { settingsRouter } from "./modules/settings/routes.js";
import { webhooksRouter } from "./modules/webhooks/routes.js";

export interface AppOptions {
  db: Database;
  apiToken: string;
  services: Services;
}

export function createApp({ db, apiToken, services }: AppOptions) {
  const app = new OpenAPIHono<AppEnv>();

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    security: [{ bearer: [] }],
    info: {
      title: "objektakte API",
      version: "0.1.0",
      description:
        "Fallakte für Energieberatung: Kontakte, Objekte, Vorgänge, Kommunikation, Belege.",
      // AGPL-3.0 §13: Nutzer über das Netzwerk müssen den Quelltext erhalten können.
      license: { name: "AGPL-3.0-only", url: "https://github.com/mbay-ODW/objektakte" },
    },
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
  });

  const api = new OpenAPIHono<AppEnv>();
  api.use(
    "*",
    bearerAuth({
      verifyToken: (token) => safeEqual(token, apiToken),
      noAuthenticationHeader: { message: { error: "unauthorized" } },
      invalidAuthenticationHeader: { message: { error: "unauthorized" } },
      invalidToken: { message: { error: "unauthorized" } },
    }),
  );
  // Größenbegrenzung schon beim Einlesen (nicht erst nach dem Puffern)
  const limit = (mb: number) =>
    bodyLimit({
      maxSize: mb * 1024 * 1024,
      onError: (c) => c.json({ error: "payload_too_large", message: `Maximal ${mb} MB` }, 413),
    });
  api.use("/incoming-invoices", limit(25));
  api.use("/bank/transactions/import-csv", limit(10));
  api.use("*", limit(65));
  api.use("*", async (c, next) => {
    c.set("db", db);
    c.set("services", services);
    // Bis OIDC angebunden ist, gibt es genau einen technischen Nutzer.
    c.set("actor", "api-token");
    await next();
  });
  api.route("/", contactsRouter);
  api.route("/", objectsRouter);
  api.route("/", casesRouter);
  api.route("/", fundingRouter);
  api.route("/", communicationsRouter);
  api.route("/", inspectionsRouter);
  api.route("/", documentsRouter);
  api.route("/", billingRouter);
  api.route("/", paymentsRouter);
  api.route("/", reportsRouter);
  api.route("/", settingsRouter);
  api.route("/", webhooksRouter);
  api.route("/", importRouter);

  app.route("/api/v1", api);

  const openApiConfig = {
    openapi: "3.1.0",
    info: { title: "objektakte API", version: "0.1.0" },
  };
  const mcp = createMcpHandler({
    getDocument: () => app.getOpenAPI31Document(openApiConfig) as unknown as OpenApiDocument,
    call: ({ url, method, body }) =>
      Promise.resolve(
        app.request(url, {
          method,
          body,
          headers: {
            authorization: `Bearer ${apiToken}`,
            ...(body ? { "content-type": "application/json" } : {}),
          },
        }),
      ),
  });
  app.use("/mcp", bearerAuth({ verifyToken: (token) => safeEqual(token, apiToken) }));
  app.all("/mcp", (c) => mcp(c.req.raw));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof DomainError) {
      return c.json({ error: errorCode(err.status), message: err.message }, err.status);
    }
    const unique = uniqueViolation(err);
    if (unique) return c.json({ error: "conflict", message: unique }, 409);
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function uniqueViolation(err: unknown): string | undefined {
  const e = (err as { cause?: unknown })?.cause ?? err;
  if (e && typeof e === "object" && "code" in e && e.code === "23505") {
    return "detail" in e && typeof e.detail === "string" ? e.detail : "Eindeutigkeitsverletzung";
  }
  return undefined;
}
