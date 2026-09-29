import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { Services } from "../adapters/index.js";
import type { Database } from "../db/client.js";

export interface AppEnv {
  Variables: {
    db: Database;
    actor: string;
    services: Services;
  };
}

export const createRouter = () =>
  new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: "validation_failed" as const,
            problems: result.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          },
          400,
        );
      }
    },
  });

export const ValidationError = z
  .object({
    error: z.literal("validation_failed"),
    problems: z.array(z.object({ path: z.string(), message: z.string() })),
  })
  .openapi("ValidationError");

export const NotFound = z.object({ error: z.literal("not_found") }).openapi("NotFound");

export const UuidParam = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" } }),
});

export const Pagination = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
