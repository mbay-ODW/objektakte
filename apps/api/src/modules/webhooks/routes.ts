import { randomBytes } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, desc, eq, gt, inArray, type SQL } from "drizzle-orm";
import { events, webhookSubscriptions } from "../../db/schema.js";
import { ErrorResponse } from "../../lib/errors.js";
import { createRouter, UuidParam, ValidationError } from "../../lib/http.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const Webhook = z
  .object({
    id: z.uuid(),
    url: z.string(),
    eventTypes: z.array(z.string()),
    active: z.boolean(),
    lastEventId: z.number().int(),
    failures: z.number().int(),
    lastError: z.string().nullable(),
  })
  .openapi("Webhook");

const WebhookCreated = Webhook.extend({
  secret: z.string().openapi({ description: "Nur bei der Anlage sichtbar" }),
}).openapi("WebhookCreated");

const Event = z
  .object({
    id: z.number().int(),
    occurredAt: z.string(),
    type: z.string(),
    entityType: z.string(),
    entityId: z.uuid(),
    actor: z.string(),
    payload: z.unknown(),
  })
  .openapi("Event");

const pattern = z
  .string()
  .regex(/^(\*|[a-z_]+\.(\*|[a-z_]+))$/, 'z. B. "*", "case.*", "deadline.created"');

const toWebhook = (w: typeof webhookSubscriptions.$inferSelect): z.infer<typeof Webhook> => ({
  id: w.id,
  url: w.url,
  eventTypes: w.eventTypes,
  active: w.active,
  lastEventId: w.lastEventId,
  failures: w.failures,
  lastError: w.lastError,
});

const list = createRoute({
  method: "get",
  path: "/webhooks",
  operationId: "listWebhooks",
  tags: ["Ereignisse"],
  summary: "Webhook-Abonnements",
  responses: {
    200: { description: "Abonnements", content: json(z.object({ items: z.array(Webhook) })) },
  },
});

const create = createRoute({
  method: "post",
  path: "/webhooks",
  operationId: "createWebhook",
  tags: ["Ereignisse"],
  summary: "Webhook abonnieren (Zustellung ab jetzt, signiert per HMAC-SHA256)",
  request: {
    body: {
      required: true,
      content: json(
        z.object({
          url: z.url({ protocol: /^https?$/ }),
          eventTypes: z.array(pattern).min(1).default(["*"]),
          secret: z.string().min(16).optional(),
          /** true = auch alle bisherigen Ereignisse zustellen */
          replay: z.boolean().default(false),
        }),
      ),
    },
  },
  responses: {
    201: { description: "Angelegt", content: json(WebhookCreated) },
    400: { description: "Ungültig", content: json(ValidationError) },
  },
});

const patch = createRoute({
  method: "patch",
  path: "/webhooks/{id}",
  operationId: "updateWebhook",
  tags: ["Ereignisse"],
  summary: "Webhook ändern, pausieren oder Fehlerzustand zurücksetzen",
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: json(
        z.object({
          url: z.url({ protocol: /^https?$/ }).optional(),
          eventTypes: z.array(pattern).min(1).optional(),
          active: z.boolean().optional(),
          resetFailures: z.boolean().optional(),
        }),
      ),
    },
  },
  responses: {
    200: { description: "Geändert", content: json(Webhook) },
    404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  },
});

const remove = createRoute({
  method: "delete",
  path: "/webhooks/{id}",
  operationId: "deleteWebhook",
  tags: ["Ereignisse"],
  summary: "Webhook löschen",
  request: { params: UuidParam },
  responses: {
    204: { description: "Gelöscht" },
    404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  },
});

const feed = createRoute({
  method: "get",
  path: "/events",
  operationId: "listEvents",
  tags: ["Ereignisse"],
  summary: "Ereignisprotokoll lesen (Cursor-basiert, z. B. für Polling oder Nachvollziehbarkeit)",
  request: {
    query: z.object({
      after: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(1000).default(100),
      entityId: z.uuid().optional(),
      types: z.string().optional().openapi({ description: "Kommagetrennte exakte Ereignistypen" }),
    }),
  },
  responses: {
    200: { description: "Ereignisse", content: json(z.object({ items: z.array(Event) })) },
  },
});

export const webhooksRouter = createRouter()
  .openapi(list, async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(webhookSubscriptions)
      .orderBy(asc(webhookSubscriptions.createdAt));
    return c.json({ items: rows.map(toWebhook) }, 200);
  })
  .openapi(create, async (c) => {
    const body = c.req.valid("json");
    const db = c.get("db");
    const secret = body.secret ?? randomBytes(32).toString("hex");
    let lastEventId = 0;
    if (!body.replay) {
      const [latest] = await db
        .select({ id: events.id })
        .from(events)
        .orderBy(desc(events.id))
        .limit(1);
      lastEventId = latest?.id ?? 0;
    }
    const [row] = await db
      .insert(webhookSubscriptions)
      .values({ url: body.url, eventTypes: body.eventTypes, secret, lastEventId })
      .returning();
    if (!row) throw new Error("Webhook konnte nicht angelegt werden");
    return c.json({ ...toWebhook(row), secret }, 201);
  })
  .openapi(patch, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const set: Partial<typeof webhookSubscriptions.$inferInsert> = {};
    if (body.url) set.url = body.url;
    if (body.eventTypes) set.eventTypes = body.eventTypes;
    if (body.active !== undefined) set.active = body.active;
    if (body.resetFailures)
      Object.assign(set, { failures: 0, lastError: null, nextAttemptAt: null });
    const db = c.get("db");
    const [row] =
      Object.keys(set).length > 0
        ? await db
            .update(webhookSubscriptions)
            .set(set)
            .where(eq(webhookSubscriptions.id, id))
            .returning()
        : await db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
    if (!row) return c.json({ error: "not_found", message: "Webhook nicht gefunden" }, 404);
    return c.json(toWebhook(row), 200);
  })
  .openapi(remove, async (c) => {
    const rows = await c
      .get("db")
      .delete(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, c.req.valid("param").id))
      .returning({ id: webhookSubscriptions.id });
    if (rows.length === 0)
      return c.json({ error: "not_found", message: "Webhook nicht gefunden" }, 404);
    return c.body(null, 204);
  })
  .openapi(feed, async (c) => {
    const { after, limit, entityId, types } = c.req.valid("query");
    const filters: SQL[] = [gt(events.id, after)];
    if (entityId) filters.push(eq(events.entityId, entityId));
    const typeList = types
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (typeList && typeList.length > 0) filters.push(inArray(events.type, typeList));
    const rows = await c
      .get("db")
      .select()
      .from(events)
      .where(and(...filters))
      .orderBy(asc(events.id))
      .limit(limit);
    return c.json(
      { items: rows.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })) },
      200,
    );
  });
