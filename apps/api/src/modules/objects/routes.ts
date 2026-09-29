import { createRoute, z } from "@hono/zod-openapi";
import { asc, eq, ilike, or } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { cases, contacts, objectRoles, objects } from "../../db/schema.js";
import { ErrorResponse } from "../../lib/errors.js";
import { createRouter, NotFound, Pagination, UuidParam, ValidationError } from "../../lib/http.js";
import {
  createObject,
  ObjectCreate,
  ObjectPatch,
  RoleInput,
  replaceRoles,
  updateObject,
} from "./service.js";

export const BuildingObject = z
  .object({
    id: z.uuid(),
    label: z.string(),
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string(),
    usage: z.enum(["wohngebaeude", "nichtwohngebaeude", "gemischt", "unbekannt"]),
    buildingType: z.string().nullable(),
    constructionYear: z.number().int().nullable(),
    heatedAreaM2: z.number().nullable(),
    units: z.number().int().nullable(),
    storagePath: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .openapi("BuildingObject");

const ObjectDetail = BuildingObject.extend({
  roles: z.array(z.object({ contactId: z.uuid(), displayName: z.string(), role: z.string() })),
  cases: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      title: z.string(),
      status: z.string(),
      measureCode: z.string().nullable(),
    }),
  ),
}).openapi("ObjectDetail");

const toObject = (row: typeof objects.$inferSelect): z.infer<typeof BuildingObject> => ({
  id: row.id,
  label: row.label,
  street: row.street,
  postalCode: row.postalCode,
  city: row.city,
  country: row.country,
  usage: row.usage,
  buildingType: row.buildingType,
  constructionYear: row.constructionYear,
  heatedAreaM2: row.heatedAreaM2 == null ? null : Number(row.heatedAreaM2),
  units: row.units,
  storagePath: row.storagePath,
  notes: row.notes,
});

const listRoute = createRoute({
  method: "get",
  path: "/objects",
  operationId: "listObjects",
  tags: ["Objekte"],
  summary: "Objekte (Gebäude) suchen/auflisten",
  request: {
    query: Pagination.extend({
      q: z
        .string()
        .trim()
        .min(1)
        .optional()
        .openapi({ description: "Suche in Bezeichnung/Ort/Straße" }),
    }),
  },
  responses: {
    200: {
      description: "Objekte",
      content: { "application/json": { schema: z.object({ items: z.array(BuildingObject) }) } },
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/objects/{id}",
  operationId: "getObject",
  tags: ["Objekte"],
  summary: "Objekt mit Beteiligten und Vorgängen",
  request: { params: UuidParam },
  responses: {
    200: { description: "Objekt", content: { "application/json": { schema: ObjectDetail } } },
    404: { description: "Nicht gefunden", content: { "application/json": { schema: NotFound } } },
  },
});

const createDef = createRoute({
  method: "post",
  path: "/objects",
  operationId: "createObject",
  tags: ["Objekte"],
  summary: "Objekt (Gebäude) anlegen",
  request: { body: { required: true, content: { "application/json": { schema: ObjectCreate } } } },
  responses: {
    201: { description: "Angelegt", content: { "application/json": { schema: ObjectDetail } } },
    400: { description: "Ungültig", content: { "application/json": { schema: ValidationError } } },
  },
});

const patchDef = createRoute({
  method: "patch",
  path: "/objects/{id}",
  operationId: "updateObject",
  tags: ["Objekte"],
  summary: "Objekt ändern",
  request: {
    params: UuidParam,
    body: { required: true, content: { "application/json": { schema: ObjectPatch } } },
  },
  responses: {
    200: { description: "Geändert", content: { "application/json": { schema: ObjectDetail } } },
    400: { description: "Ungültig", content: { "application/json": { schema: ValidationError } } },
    404: {
      description: "Nicht gefunden",
      content: { "application/json": { schema: ErrorResponse } },
    },
  },
});

const rolesDef = createRoute({
  method: "put",
  path: "/objects/{id}/roles",
  operationId: "replaceObjectRoles",
  tags: ["Objekte"],
  summary: "Beteiligte eines Objekts ersetzen",
  request: {
    params: UuidParam,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ roles: z.array(RoleInput) }) } },
    },
  },
  responses: {
    200: { description: "Ersetzt", content: { "application/json": { schema: ObjectDetail } } },
    404: { description: "Nicht gefunden", content: { "application/json": { schema: NotFound } } },
  },
});

export const objectsRouter = createRouter()
  .openapi(listRoute, async (c) => {
    const { q, limit, offset } = c.req.valid("query");
    const where = q
      ? or(
          ilike(objects.label, `%${q}%`),
          ilike(objects.city, `%${q}%`),
          ilike(objects.street, `%${q}%`),
        )
      : undefined;
    const rows = await c
      .get("db")
      .select()
      .from(objects)
      .where(where)
      .orderBy(asc(objects.label))
      .limit(limit)
      .offset(offset);
    return c.json({ items: rows.map(toObject) }, 200);
  })
  .openapi(getRoute, async (c) => {
    const detail = await loadObjectDetail(c.get("db"), c.req.valid("param").id);
    if (!detail) return c.json({ error: "not_found" as const }, 404);
    return c.json(detail, 200);
  })
  .openapi(createDef, async (c) => {
    const db = c.get("db");
    const id = await db.transaction((tx) => createObject(tx, c.req.valid("json"), c.get("actor")));
    return c.json((await loadObjectDetail(db, id)) as z.infer<typeof ObjectDetail>, 201);
  })
  .openapi(patchDef, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    await db.transaction((tx) => updateObject(tx, id, c.req.valid("json"), c.get("actor")));
    return c.json((await loadObjectDetail(db, id)) as z.infer<typeof ObjectDetail>, 200);
  })
  .openapi(rolesDef, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const found = await loadObjectDetail(db, id);
    if (!found) return c.json({ error: "not_found" as const }, 404);
    await db.transaction((tx) => replaceRoles(tx, id, c.req.valid("json").roles, c.get("actor")));
    return c.json((await loadObjectDetail(db, id)) as z.infer<typeof ObjectDetail>, 200);
  });

export async function loadObjectDetail(db: Database, id: string) {
  const [row] = await db.select().from(objects).where(eq(objects.id, id));
  if (!row) return undefined;
  const roles = await db
    .select({
      contactId: objectRoles.contactId,
      displayName: contacts.displayName,
      role: objectRoles.role,
    })
    .from(objectRoles)
    .innerJoin(contacts, eq(contacts.id, objectRoles.contactId))
    .where(eq(objectRoles.objectId, id))
    .orderBy(asc(objectRoles.role), asc(contacts.displayName));
  const objectCases = await db
    .select({
      id: cases.id,
      number: cases.number,
      title: cases.title,
      status: cases.status,
      measureCode: cases.measureCode,
    })
    .from(cases)
    .where(eq(cases.objectId, id))
    .orderBy(asc(cases.openedAt));
  return { ...toObject(row), roles, cases: objectCases };
}
