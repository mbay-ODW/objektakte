import { createRoute, z } from "@hono/zod-openapi";
import { asc, eq, ilike, or } from "drizzle-orm";
import { cases, contacts, objectRoles, objects } from "../../db/schema.js";
import { createRouter, NotFound, Pagination, UuidParam } from "../../lib/http.js";

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
  tags: ["Objekte"],
  summary: "Objekt mit Beteiligten und Vorgängen",
  request: { params: UuidParam },
  responses: {
    200: { description: "Objekt", content: { "application/json": { schema: ObjectDetail } } },
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
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const [row] = await db.select().from(objects).where(eq(objects.id, id));
    if (!row) return c.json({ error: "not_found" as const }, 404);
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
    return c.json({ ...toObject(row), roles, cases: objectCases }, 200);
  });
