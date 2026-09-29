import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { contactChannels, contacts } from "../../db/schema.js";
import { changes, defined } from "../../lib/diff.js";
import { DomainError } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { normalizeChannelValue } from "../../lib/normalize.js";

const text = z.string().trim().min(1).nullish();

export const ChannelInput = z.object({
  kind: z.enum(["email", "phone", "mobile", "whatsapp", "signal", "fax", "website"]),
  value: z.string().trim().min(1),
  label: text,
  isPrimary: z.boolean().optional(),
});

const contactFields = {
  salutation: text,
  firstName: text,
  lastName: text,
  organisationName: text,
  customerNumber: text,
  street: text,
  postalCode: text,
  city: text,
  country: z.string().length(2).optional(),
  leitwegId: text,
  vatId: text,
  notes: text,
};

export const ContactCreate = z
  .object({
    kind: z.enum(["person", "organisation"]),
    displayName: text,
    ...contactFields,
    channels: z.array(ChannelInput).default([]),
  })
  .openapi("ContactCreate");

export const ContactPatch = z
  .object({
    kind: z.enum(["person", "organisation"]).optional(),
    displayName: z.string().trim().min(1).optional(),
    ...contactFields,
    /** Wenn gesetzt, ersetzt die Liste alle vorhandenen Kanäle. */
    channels: z.array(ChannelInput).optional(),
  })
  .openapi("ContactPatch");

function deriveDisplayName(c: {
  kind: string;
  displayName?: string | null;
  organisationName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const name =
    c.displayName ??
    (c.kind === "organisation"
      ? c.organisationName
      : [c.firstName, c.lastName].filter(Boolean).join(" "));
  if (!name) {
    throw new DomainError(422, "displayName, organisationName oder Vor-/Nachname erforderlich");
  }
  return name;
}

export async function replaceChannels(
  tx: DbOrTx,
  contactId: string,
  channels: z.infer<typeof ChannelInput>[],
) {
  await tx.delete(contactChannels).where(eq(contactChannels.contactId, contactId));
  const seen = new Set<string>();
  const rows = [];
  for (const ch of channels) {
    const normalizedValue = normalizeChannelValue(ch.kind, ch.value);
    const key = `${ch.kind}|${normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      contactId,
      kind: ch.kind,
      value: ch.value,
      normalizedValue,
      label: ch.label ?? null,
      isPrimary: ch.isPrimary ?? false,
    });
  }
  if (rows.length > 0) await tx.insert(contactChannels).values(rows);
}

export async function createContact(
  tx: DbOrTx,
  input: z.infer<typeof ContactCreate>,
  actor: string,
): Promise<string> {
  const { channels, ...fields } = input;
  const [row] = await tx
    .insert(contacts)
    .values({
      ...nullify(fields),
      country: fields.country ?? "DE",
      kind: input.kind,
      displayName: deriveDisplayName(input),
    })
    .returning({ id: contacts.id });
  if (!row) throw new Error("Kontakt konnte nicht angelegt werden");
  await replaceChannels(tx, row.id, channels);
  await recordEvents(tx, [
    {
      entityType: "contact",
      entityId: row.id,
      type: "contact.created",
      actor,
      payload: { displayName: deriveDisplayName(input) },
    },
  ]);
  return row.id;
}

export async function updateContact(
  tx: DbOrTx,
  id: string,
  patch: z.infer<typeof ContactPatch>,
  actor: string,
) {
  const [before] = await tx.select().from(contacts).where(eq(contacts.id, id));
  if (!before) throw new DomainError(404, "Kontakt nicht gefunden");
  const { channels, ...fields } = patch;
  const set = defined(fields);
  const diff = changes(before, set);
  if (Object.keys(set).length > 0) await tx.update(contacts).set(set).where(eq(contacts.id, id));
  if (channels) await replaceChannels(tx, id, channels);
  if (Object.keys(diff).length > 0 || channels) {
    await recordEvents(tx, [
      {
        entityType: "contact",
        entityId: id,
        type: "contact.updated",
        actor,
        payload: { changes: diff, channelsReplaced: Boolean(channels) },
      },
    ]);
  }
}

/** Wandelt undefined in null um (für Inserts). */
export function nullify<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> | null } {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ?? null])) as never;
}
