import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { objectRoles, objects } from "../../db/schema.js";
import { changes, defined } from "../../lib/diff.js";
import { DomainError } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { nullify } from "../contacts/service.js";

const text = z.string().trim().min(1).nullish();
export const ObjectUsage = z.enum(["wohngebaeude", "nichtwohngebaeude", "gemischt", "unbekannt"]);
export const ObjectRole = z.enum([
  "eigentuemer",
  "verwaltung",
  "nutzer",
  "ansprechpartner",
  "handwerker",
  "planer",
  "sonstige",
]);

const objectFields = {
  street: text,
  postalCode: text,
  city: text,
  country: z.string().length(2).optional(),
  usage: ObjectUsage.optional(),
  buildingType: text,
  constructionYear: z.number().int().min(1000).max(2100).nullish(),
  heatedAreaM2: z.number().positive().nullish(),
  units: z.number().int().positive().nullish(),
  storagePath: text,
  notes: text,
};

export const RoleInput = z.object({ contactId: z.uuid(), role: ObjectRole });

export const ObjectCreate = z
  .object({
    label: z.string().trim().min(1),
    ...objectFields,
    roles: z.array(RoleInput).default([]),
  })
  .openapi("ObjectCreate");

export const ObjectPatch = z
  .object({ label: z.string().trim().min(1).optional(), ...objectFields })
  .openapi("ObjectPatch");

function toRow(fields: Record<string, unknown>) {
  const { heatedAreaM2, ...rest } = fields;
  return heatedAreaM2 === undefined
    ? rest
    : { ...rest, heatedAreaM2: heatedAreaM2 === null ? null : String(heatedAreaM2) };
}

export async function createObject(
  tx: DbOrTx,
  input: z.infer<typeof ObjectCreate>,
  actor: string,
): Promise<string> {
  const { roles, ...fields } = input;
  const [row] = await tx
    .insert(objects)
    .values({
      ...(toRow(nullify(fields)) as typeof objects.$inferInsert),
      label: input.label,
      country: input.country ?? "DE",
      usage: input.usage ?? "unbekannt",
    })
    .returning({ id: objects.id });
  if (!row) throw new Error("Objekt konnte nicht angelegt werden");
  await replaceRoles(tx, row.id, roles);
  await recordEvents(tx, [
    {
      entityType: "object",
      entityId: row.id,
      type: "object.created",
      actor,
      payload: { label: input.label },
    },
  ]);
  return row.id;
}

export async function updateObject(
  tx: DbOrTx,
  id: string,
  patch: z.infer<typeof ObjectPatch>,
  actor: string,
) {
  const [before] = await tx.select().from(objects).where(eq(objects.id, id));
  if (!before) throw new DomainError(404, "Objekt nicht gefunden");
  const set = toRow(defined(patch));
  const diff = changes(before, set);
  if (Object.keys(diff).length === 0) return;
  await tx.update(objects).set(set).where(eq(objects.id, id));
  await recordEvents(tx, [
    {
      entityType: "object",
      entityId: id,
      type: "object.updated",
      actor,
      payload: { changes: diff },
    },
  ]);
}

export async function replaceRoles(
  tx: DbOrTx,
  objectId: string,
  roles: z.infer<typeof RoleInput>[],
  actor?: string,
) {
  await tx.delete(objectRoles).where(eq(objectRoles.objectId, objectId));
  const unique = new Map(roles.map((r) => [`${r.contactId}|${r.role}`, r]));
  if (unique.size > 0) {
    await tx
      .insert(objectRoles)
      .values(
        [...unique.values()].map((r) => ({ objectId, contactId: r.contactId, role: r.role })),
      );
  }
  if (actor) {
    await recordEvents(tx, [
      {
        entityType: "object",
        entityId: objectId,
        type: "object.roles_replaced",
        actor,
        payload: { roles: [...unique.values()] },
      },
    ]);
  }
}
