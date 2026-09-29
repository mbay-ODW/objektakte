import { timingSafeEqual } from "node:crypto";
import { OpenAPIHono } from "@hono/zod-openapi";
import { bearerAuth } from "hono/bearer-auth";
import { HTTPException } from "hono/http-exception";
import type { Database } from "./db/client.js";
import type { AppEnv } from "./lib/http.js";
import { casesRouter } from "./modules/cases/routes.js";
import { contactsRouter } from "./modules/contacts/routes.js";
import { importRouter } from "./modules/import/routes.js";
import { objectsRouter } from "./modules/objects/routes.js";

export interface AppOptions {
  db: Database;
  apiToken: string;
}

export function createApp({ db, apiToken }: AppOptions) {
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
  api.use("*", async (c, next) => {
    c.set("db", db);
    // Bis OIDC angebunden ist, gibt es genau einen technischen Nutzer.
    c.set("actor", "api-token");
    await next();
  });
  api.route("/", contactsRouter);
  api.route("/", objectsRouter);
  api.route("/", casesRouter);
  api.route("/", importRouter);

  app.route("/api/v1", api);

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
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
