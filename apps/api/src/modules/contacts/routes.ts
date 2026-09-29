import { createRoute, z } from "@hono/zod-openapi";
import { asc, eq, ilike, or } from "drizzle-orm";
import { contactChannels, contacts } from "../../db/schema.js";
import { createRouter, NotFound, Pagination, UuidParam } from "../../lib/http.js";

export const Channel = z
  .object({
    kind: z.string(),
    value: z.string(),
    label: z.string().nullable(),
    isPrimary: z.boolean(),
  })
  .openapi("Channel");

export const Contact = z
  .object({
    id: z.uuid(),
    kind: z.enum(["person", "organisation"]),
    displayName: z.string(),
    salutation: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    organisationName: z.string().nullable(),
    customerNumber: z.string().nullable(),
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string(),
    leitwegId: z.string().nullable(),
    vatId: z.string().nullable(),
    notes: z.string().nullable(),
  })
  .openapi("Contact");

const ContactDetail = Contact.extend({ channels: z.array(Channel) }).openapi("ContactDetail");

const toContact = (row: typeof contacts.$inferSelect): z.infer<typeof Contact> => ({
  id: row.id,
  kind: row.kind,
  displayName: row.displayName,
  salutation: row.salutation,
  firstName: row.firstName,
  lastName: row.lastName,
  organisationName: row.organisationName,
  customerNumber: row.customerNumber,
  street: row.street,
  postalCode: row.postalCode,
  city: row.city,
  country: row.country,
  leitwegId: row.leitwegId,
  vatId: row.vatId,
  notes: row.notes,
});

const listRoute = createRoute({
  method: "get",
  path: "/contacts",
  tags: ["Kontakte"],
  summary: "Kontakte suchen/auflisten",
  request: {
    query: Pagination.extend({
      q: z.string().trim().min(1).optional().openapi({ description: "Suche in Name/Kundennummer" }),
    }),
  },
  responses: {
    200: {
      description: "Kontakte",
      content: { "application/json": { schema: z.object({ items: z.array(Contact) }) } },
    },
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/contacts/{id}",
  tags: ["Kontakte"],
  summary: "Kontakt mit Kommunikationskanälen",
  request: { params: UuidParam },
  responses: {
    200: { description: "Kontakt", content: { "application/json": { schema: ContactDetail } } },
    404: { description: "Nicht gefunden", content: { "application/json": { schema: NotFound } } },
  },
});

export const contactsRouter = createRouter()
  .openapi(listRoute, async (c) => {
    const { q, limit, offset } = c.req.valid("query");
    const where = q
      ? or(ilike(contacts.displayName, `%${q}%`), ilike(contacts.customerNumber, `%${q}%`))
      : undefined;
    const rows = await c
      .get("db")
      .select()
      .from(contacts)
      .where(where)
      .orderBy(asc(contacts.displayName))
      .limit(limit)
      .offset(offset);
    return c.json({ items: rows.map(toContact) }, 200);
  })
  .openapi(getRoute, async (c) => {
    const { id } = c.req.valid("param");
    const db = c.get("db");
    const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
    if (!row) return c.json({ error: "not_found" as const }, 404);
    const channels = await db
      .select({
        kind: contactChannels.kind,
        value: contactChannels.value,
        label: contactChannels.label,
        isPrimary: contactChannels.isPrimary,
      })
      .from(contactChannels)
      .where(eq(contactChannels.contactId, id));
    return c.json({ ...toContact(row), channels }, 200);
  });
