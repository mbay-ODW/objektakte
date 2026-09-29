import { z } from "@hono/zod-openapi";
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import {
  cases,
  communications,
  contactChannels,
  documents,
  objectRoles,
  objects,
} from "../../db/schema.js";
import { DomainError } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { normalizeChannelValue } from "../../lib/normalize.js";
import { getSetting } from "../../lib/settings.js";
import { CaseCreate, createCase } from "../cases/service.js";
import { type ChannelInput, ContactCreate, createContact } from "../contacts/service.js";
import { type CandidateCase, matchCommunication } from "./matcher.js";

export const Participant = z.object({
  role: z.enum(["from", "to", "cc"]),
  address: z.string().trim().min(1),
  name: z.string().trim().min(1).nullish(),
});

export const IngestMessage = z
  .object({
    /** Herkunft, z. B. "postfach-info" oder "whatsapp-geschaeftlich". */
    source: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/),
    /** Eindeutige ID in der Quelle (Message-ID, Nachrichten-ID) – verhindert Doppelimporte. */
    sourceRef: z.string().min(1).max(500),
    channel: z.enum(["email", "whatsapp", "signal", "telefon", "vor_ort", "brief", "notiz"]),
    direction: z.enum(["eingehend", "ausgehend", "intern"]),
    occurredAt: z.iso.datetime({ offset: true }),
    subject: z.string().nullish(),
    body: z.string().nullish(),
    author: z.string().nullish(),
    participants: z.array(Participant).default([]),
    attachments: z
      .array(
        z.object({
          title: z.string().trim().min(1),
          storage: z.enum(["nextcloud", "paperless", "url"]),
          location: z.string().trim().min(1),
          mimeType: z.string().nullish(),
        }),
      )
      .default([]),
  })
  .openapi("IngestMessage");

export type IngestMessage = z.infer<typeof IngestMessage>;

const channelKindFor = (channel: string) => (channel === "email" ? "email" : "phone");
const PHONE_KINDS = ["phone", "mobile", "whatsapp", "signal", "fax"] as const;

/** Adressen des Gegenübers: bei eingehenden Nachrichten der Absender, sonst die Empfänger. */
export function counterpartAddresses(
  msg: Pick<IngestMessage, "direction" | "participants">,
  ownAddresses: string[],
  kind: "email" | "phone",
): string[] {
  const own = new Set(ownAddresses.map((a) => normalizeChannelValue(kind, a)));
  const roles = msg.direction === "eingehend" ? ["from"] : ["to", "cc"];
  const result = new Set<string>();
  for (const p of msg.participants) {
    if (!roles.includes(p.role)) continue;
    const n = normalizeChannelValue(kind, p.address);
    if (n && !own.has(n)) result.add(n);
  }
  return [...result];
}

async function findContacts(tx: DbOrTx, kind: "email" | "phone", addresses: string[]) {
  if (addresses.length === 0) return [];
  const rows = await tx
    .selectDistinct({ contactId: contactChannels.contactId })
    .from(contactChannels)
    .where(
      and(
        inArray(contactChannels.normalizedValue, addresses),
        kind === "email"
          ? eq(contactChannels.kind, "email")
          : inArray(contactChannels.kind, [...PHONE_KINDS]),
      ),
    );
  return rows.map((r) => r.contactId);
}

/**
 * Lädt alle Vorgänge als Kandidaten: die Nummernsuche braucht den Gesamtbestand, die
 * Kontaktzuordnung filtert der Matcher selbst (Kunde oder über Objektrollen beteiligt).
 * Für Büro-Größenordnungen (einige tausend Vorgänge) unkritisch.
 */
async function loadCandidateCases(tx: DbOrTx): Promise<CandidateCase[]> {
  const rows = await tx
    .select({
      id: cases.id,
      number: cases.number,
      title: cases.title,
      customerId: cases.customerId,
      status: cases.status,
      objectId: cases.objectId,
      objectLabel: objects.label,
      street: objects.street,
      city: objects.city,
    })
    .from(cases)
    .leftJoin(objects, eq(objects.id, cases.objectId));
  const roleRows = await tx
    .select({ objectId: objectRoles.objectId, contactId: objectRoles.contactId })
    .from(objectRoles);
  const rolesByObject = new Map<string, string[]>();
  for (const r of roleRows) {
    rolesByObject.set(r.objectId, [...(rolesByObject.get(r.objectId) ?? []), r.contactId]);
  }
  return rows.map(({ objectId, ...c }) => ({
    ...c,
    relatedContactIds: objectId ? (rolesByObject.get(objectId) ?? []) : [],
  }));
}

export async function matchFor(tx: DbOrTx, msg: IngestMessage) {
  const settings = await getSetting(tx, "communication");
  const kind = channelKindFor(msg.channel);
  const addresses = counterpartAddresses(msg, settings.ownAddresses, kind);
  const ignored = new Set(settings.ignoredAddresses.map((a) => normalizeChannelValue(kind, a)));
  if (addresses.length > 0 && addresses.every((a) => ignored.has(a))) {
    return { ignored: true as const, addresses };
  }
  const contactIds = await findContacts(tx, kind, addresses);
  const candidates = await loadCandidateCases(tx);
  const result = matchCommunication({
    subject: msg.subject ?? null,
    body: msg.body ?? null,
    contactIds,
    cases: candidates,
  });
  const auto = result.caseId !== null && result.confidence >= settings.autoAssignThreshold;
  return { ignored: false as const, addresses, result, auto };
}

export async function ingestMessage(tx: DbOrTx, msg: IngestMessage, actor: string) {
  const [existing] = await tx
    .select({ id: communications.id })
    .from(communications)
    .where(and(eq(communications.source, msg.source), eq(communications.sourceRef, msg.sourceRef)));
  if (existing) return { id: existing.id, duplicate: true as const };

  const match = await matchFor(tx, msg);
  const values: typeof communications.$inferInsert = {
    channel: msg.channel,
    direction: msg.direction,
    occurredAt: new Date(msg.occurredAt),
    subject: msg.subject ?? null,
    body: msg.body ?? null,
    author: msg.author ?? null,
    participants: msg.participants,
    source: msg.source,
    sourceRef: msg.sourceRef,
  };
  if (match.ignored) {
    Object.assign(values, {
      assignmentStatus: "ignoriert",
      matchReason: "Adresse auf Ignorierliste",
    });
  } else {
    const r = match.result;
    Object.assign(values, {
      contactId: r.contactId,
      caseId: match.auto ? r.caseId : null,
      matchConfidence: String(r.confidence),
      matchReason: r.reason,
      matchCandidates: r.candidates,
      assignmentStatus: match.auto ? "automatisch" : "offen",
    });
  }
  const [row] = await tx.insert(communications).values(values).returning();
  if (!row) throw new Error("Nachricht konnte nicht gespeichert werden");

  if (msg.attachments.length > 0) {
    await tx
      .insert(documents)
      .values(
        msg.attachments.map((a) => ({
          communicationId: row.id,
          caseId: row.caseId,
          contactId: row.contactId,
          title: a.title,
          docClass: "anhang",
          storage: a.storage,
          location: a.location,
          mimeType: a.mimeType ?? null,
        })),
      )
      .onConflictDoNothing();
  }

  await recordEvents(tx, [
    {
      entityType: "communication",
      entityId: row.id,
      type: "communication.received",
      actor,
      payload: {
        channel: row.channel,
        direction: row.direction,
        caseId: row.caseId,
        contactId: row.contactId,
        assignmentStatus: row.assignmentStatus,
        reason: row.matchReason,
      },
    },
  ]);
  return { id: row.id, duplicate: false as const };
}

/** Ordnet offene Nachrichten erneut zu (z. B. nachdem ein Kanal gelernt wurde). */
export async function rematchOpen(tx: DbOrTx, actor: string) {
  const open = await tx
    .select()
    .from(communications)
    .where(eq(communications.assignmentStatus, "offen"));
  let assigned = 0;
  for (const c of open) {
    const match = await matchFor(tx, {
      source: c.source ?? "unbekannt",
      sourceRef: c.sourceRef ?? c.id,
      channel: c.channel,
      direction: c.direction,
      occurredAt: c.occurredAt.toISOString(),
      subject: c.subject,
      body: c.body,
      author: c.author,
      participants: c.participants as IngestMessage["participants"],
      attachments: [],
    });
    if (match.ignored) {
      await tx
        .update(communications)
        .set({ assignmentStatus: "ignoriert" })
        .where(eq(communications.id, c.id));
      continue;
    }
    const r = match.result;
    await tx
      .update(communications)
      .set({
        contactId: r.contactId ?? c.contactId,
        caseId: match.auto ? r.caseId : null,
        matchConfidence: String(r.confidence),
        matchReason: r.reason,
        matchCandidates: r.candidates,
        assignmentStatus: match.auto ? "automatisch" : "offen",
      })
      .where(eq(communications.id, c.id));
    if (match.auto) {
      assigned++;
      await recordEvents(tx, [
        {
          entityType: "communication",
          entityId: c.id,
          type: "communication.assigned",
          actor,
          payload: { caseId: r.caseId, automatic: true, reason: r.reason },
        },
      ]);
    }
  }
  return { checked: open.length, assigned };
}

export const AssignInput = z
  .object({
    caseId: z.uuid().nullish(),
    contactId: z.uuid().nullish(),
    /** Absender-/Empfängeradressen dem Kontakt als Kanal hinzufügen (lernt für künftige Zuordnung). */
    learnChannel: z.boolean().default(false),
  })
  .openapi("AssignCommunication");

export async function assignCommunication(
  tx: DbOrTx,
  id: string,
  input: z.infer<typeof AssignInput>,
  actor: string,
) {
  const [c] = await tx.select().from(communications).where(eq(communications.id, id));
  if (!c) throw new DomainError(404, "Nachricht nicht gefunden");
  let contactId = input.contactId ?? c.contactId;
  if (input.caseId) {
    const [kase] = await tx.select().from(cases).where(eq(cases.id, input.caseId));
    if (!kase) throw new DomainError(422, "Vorgang nicht gefunden");
    contactId ??= kase.customerId;
  }
  await tx
    .update(communications)
    .set({
      caseId: input.caseId ?? null,
      contactId,
      assignmentStatus: "bestaetigt",
      matchConfidence: null,
    })
    .where(eq(communications.id, id));
  await tx
    .update(documents)
    .set({ caseId: input.caseId ?? null, contactId })
    .where(eq(documents.communicationId, id));

  let learned: string[] = [];
  if (input.learnChannel && contactId) learned = await learnChannels(tx, contactId, c);

  await recordEvents(tx, [
    {
      entityType: "communication",
      entityId: id,
      type: "communication.assigned",
      actor,
      payload: { caseId: input.caseId ?? null, contactId, automatic: false, learned },
    },
  ]);
}

async function learnChannels(
  tx: DbOrTx,
  contactId: string,
  c: typeof communications.$inferSelect,
): Promise<string[]> {
  const settings = await getSetting(tx, "communication");
  const kind = channelKindFor(c.channel);
  const msg = {
    direction: c.direction,
    participants: c.participants as IngestMessage["participants"],
  };
  const addresses = counterpartAddresses(msg, settings.ownAddresses, kind);
  const channelKind =
    c.channel === "whatsapp" ? "whatsapp" : c.channel === "signal" ? "signal" : kind;
  const learned: string[] = [];
  for (const p of msg.participants) {
    const normalized = normalizeChannelValue(kind, p.address);
    if (!addresses.includes(normalized)) continue;
    const inserted = await tx
      .insert(contactChannels)
      .values({
        contactId,
        kind: channelKind,
        value: p.address,
        normalizedValue: normalized,
        label: "gelernt",
      })
      .onConflictDoNothing()
      .returning({ id: contactChannels.id });
    if (inserted.length > 0) learned.push(p.address);
  }
  return learned;
}

export const LeadInput = z
  .object({
    contact: ContactCreate.optional().openapi({
      description: "Neuer Kontakt; leer = vorhandenen Kontakt der Nachricht verwenden",
    }),
    case: CaseCreate.omit({ customerId: true }),
  })
  .openapi("CreateLead");

/** Legt aus einer Nachricht eine Anfrage an: Kontakt (inkl. Absenderkanal) + Vorgang. */
export async function createLead(
  tx: DbOrTx,
  id: string,
  input: z.infer<typeof LeadInput>,
  actor: string,
) {
  const [c] = await tx.select().from(communications).where(eq(communications.id, id));
  if (!c) throw new DomainError(404, "Nachricht nicht gefunden");
  let contactId = c.contactId;
  if (input.contact) {
    const settings = await getSetting(tx, "communication");
    const kind = channelKindFor(c.channel);
    const participants = c.participants as IngestMessage["participants"];
    const addresses = counterpartAddresses(
      { direction: c.direction, participants },
      settings.ownAddresses,
      kind,
    );
    const extra: z.infer<typeof ChannelInput>[] = participants
      .filter((p) => addresses.includes(normalizeChannelValue(kind, p.address)))
      .map((p) => ({
        kind: c.channel === "whatsapp" ? "whatsapp" : c.channel === "signal" ? "signal" : kind,
        value: p.address,
      }));
    contactId = await createContact(
      tx,
      { ...input.contact, channels: [...input.contact.channels, ...extra] },
      actor,
    );
  }
  if (!contactId) throw new DomainError(422, "Kontakt fehlt: bitte Kontaktdaten angeben");
  const caseId = await createCase(
    tx,
    { ...input.case, customerId: contactId, status: input.case.status ?? "anfrage" },
    actor,
  );
  await assignCommunication(tx, id, { caseId, contactId, learnChannel: false }, actor);
  return { contactId, caseId };
}

export async function setAssignmentStatus(
  tx: DbOrTx,
  id: string,
  status: "bestaetigt" | "ignoriert",
  actor: string,
) {
  const [c] = await tx.select().from(communications).where(eq(communications.id, id));
  if (!c) throw new DomainError(404, "Nachricht nicht gefunden");
  if (status === "bestaetigt" && c.assignmentStatus !== "automatisch") {
    throw new DomainError(422, "Nur automatisch zugeordnete Nachrichten können bestätigt werden");
  }
  await tx
    .update(communications)
    .set({ assignmentStatus: status })
    .where(eq(communications.id, id));
  await recordEvents(tx, [
    {
      entityType: "communication",
      entityId: id,
      type: status === "bestaetigt" ? "communication.confirmed" : "communication.ignored",
      actor,
      payload: {},
    },
  ]);
}
