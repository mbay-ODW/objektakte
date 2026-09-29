import { and, eq } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Database, Tx } from "../../db/client.js";
import {
  billingDocuments,
  cases,
  communications,
  contactChannels,
  contacts,
  documents,
  externalRefs,
  measureTypes,
  objectRoles,
  objects,
} from "../../db/schema.js";
import { type EntityType, type EventInput, recordEvents } from "../../lib/events.js";
import { normalizeChannelValue } from "../../lib/normalize.js";
import type { ImportBatch, ImportResult } from "./schema.js";

export interface Problem {
  path: string;
  message: string;
}

/** Import wurde vollständig zurückgerollt; `problems` beschreibt die Ursachen. */
export class ImportFailed extends Error {
  constructor(readonly problems: Problem[]) {
    super(`Import fehlgeschlagen (${problems.length} Problem(e))`);
  }
}

class DryRunRollback extends Error {}

type Counts = ImportResult["contacts"];
type Action = "created" | "updated" | "unchanged";
type TableWithId = PgTable & { id: AnyPgColumn };

const emptyCounts = (): Counts => ({ created: 0, updated: 0, unchanged: 0 });

/**
 * Importiert einen Datenbestand im neutralen Austauschformat.
 *
 * - idempotent: Datensätze werden über (source, Typ, externalId) wiedererkannt und aktualisiert
 * - atomar: bei einem Problem wird der gesamte Batch zurückgerollt
 * - protokolliert jede Anlage/Änderung im Ereignisprotokoll
 */
export async function runImport(
  db: Database,
  batch: ImportBatch,
  actor: string,
): Promise<ImportResult> {
  const duplicateProblems = findDuplicateIds(batch);
  if (duplicateProblems.length > 0) throw new ImportFailed(duplicateProblems);

  let result: ImportResult | undefined;
  try {
    await db.transaction(async (tx) => {
      const run = new ImportRun(tx, batch.source, actor);
      await run.loadRefs();
      const r: ImportResult = {
        dryRun: batch.dryRun,
        contacts: await run.importContacts(batch.contacts),
        objects: await run.importObjects(batch.objects),
        cases: await run.importCases(batch.cases),
        communications: emptyCounts(),
        documents: emptyCounts(),
        billingDocuments: emptyCounts(),
      };
      // Dokumente vor Kommunikation/Belegen, weil Belege auf ihr PDF verweisen können.
      r.documents = await run.importDocuments(batch.documents);
      r.communications = await run.importCommunications(batch.communications);
      r.billingDocuments = await run.importBillingDocuments(batch.billingDocuments);

      if (run.problems.length > 0) throw new ImportFailed(run.problems);
      await recordEvents(tx, run.events);
      result = r;
      if (batch.dryRun) throw new DryRunRollback();
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return result as ImportResult;
    const unique = asUniqueViolation(err);
    if (unique) throw new ImportFailed([{ path: "", message: unique }]);
    throw err;
  }
  return result as ImportResult;
}

function findDuplicateIds(batch: ImportBatch): Problem[] {
  const problems: Problem[] = [];
  const lists = {
    contacts: batch.contacts,
    objects: batch.objects,
    cases: batch.cases,
    communications: batch.communications,
    documents: batch.documents,
    billingDocuments: batch.billingDocuments,
  };
  for (const [name, items] of Object.entries(lists)) {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.externalId)) {
        problems.push({
          path: `${name}[${i}].externalId`,
          message: `externalId "${item.externalId}" kommt mehrfach vor`,
        });
      }
      seen.add(item.externalId);
    });
  }
  return problems;
}

function asUniqueViolation(err: unknown): string | undefined {
  const e = (err as { cause?: unknown })?.cause ?? err;
  if (e && typeof e === "object" && "code" in e && e.code === "23505") {
    const detail = "detail" in e && typeof e.detail === "string" ? e.detail : "";
    return `Eindeutigkeitsverletzung: ${detail}`.trim();
  }
  return undefined;
}

class ImportRun {
  readonly problems: Problem[] = [];
  readonly events: EventInput[] = [];
  private readonly refs = new Map<string, string>();

  constructor(
    private readonly tx: Tx,
    private readonly source: string,
    private readonly actor: string,
  ) {}

  async loadRefs() {
    const rows = await this.tx
      .select()
      .from(externalRefs)
      .where(eq(externalRefs.source, this.source));
    for (const r of rows) this.refs.set(refKey(r.externalType, r.externalId), r.entityId);
  }

  /** Löst eine externe ID auf; unbekannte IDs werden als Problem vermerkt. */
  private resolve(type: EntityType, externalId: string, path: string): string | null {
    const id = this.refs.get(refKey(type, externalId));
    if (!id) {
      this.problems.push({ path, message: `unbekannte ${type}-Referenz "${externalId}"` });
      return null;
    }
    return id;
  }

  private resolveOptional(
    type: EntityType,
    externalId: string | null | undefined,
    path: string,
  ): string | null {
    return externalId ? this.resolve(type, externalId, path) : null;
  }

  private async upsert(
    table: TableWithId,
    type: EntityType,
    externalId: string,
    values: Record<string, unknown>,
  ): Promise<{ id: string; action: Action }> {
    const knownId = this.refs.get(refKey(type, externalId));
    if (knownId) {
      const [existing] = await this.tx.select().from(table).where(eq(table.id, knownId));
      if (existing) {
        if (isSame(existing as Record<string, unknown>, values)) {
          return { id: knownId, action: "unchanged" };
        }
        await this.tx
          .update(table)
          .set(values as never)
          .where(eq(table.id, knownId));
        this.event(type, knownId, externalId, "updated");
        return { id: knownId, action: "updated" };
      }
    }

    const [row] = (await this.tx
      .insert(table)
      .values(values as never)
      .returning({ id: table.id })) as { id: string }[];
    if (!row) throw new Error(`Insert in ${type} lieferte keine ID`);
    await this.tx
      .insert(externalRefs)
      .values({ source: this.source, externalType: type, externalId, entityId: row.id })
      .onConflictDoUpdate({
        target: [externalRefs.source, externalRefs.externalType, externalRefs.externalId],
        set: { entityId: row.id },
      });
    this.refs.set(refKey(type, externalId), row.id);
    this.event(type, row.id, externalId, "created");
    return { id: row.id, action: "created" };
  }

  private event(type: EntityType, id: string, externalId: string, action: "created" | "updated") {
    this.events.push({
      entityType: type,
      entityId: id,
      type: `${type}.imported`,
      actor: this.actor,
      payload: { source: this.source, externalId, action },
    });
  }

  async importContacts(items: ImportBatch["contacts"]): Promise<Counts> {
    const counts = emptyCounts();
    for (const c of items) {
      const displayName =
        c.displayName ??
        (c.kind === "organisation"
          ? c.organisationName
          : [c.firstName, c.lastName].filter(Boolean).join(" ")) ??
        "";
      if (!displayName) {
        this.problems.push({
          path: `contacts[${c.externalId}]`,
          message: "displayName, organisationName oder Vor-/Nachname erforderlich",
        });
        continue;
      }
      const { id, action } = await this.upsert(contacts, "contact", c.externalId, {
        kind: c.kind,
        displayName,
        salutation: c.salutation ?? null,
        firstName: c.firstName ?? null,
        lastName: c.lastName ?? null,
        organisationName: c.organisationName ?? null,
        customerNumber: c.customerNumber ?? null,
        street: c.street ?? null,
        postalCode: c.postalCode ?? null,
        city: c.city ?? null,
        country: c.country ?? "DE",
        leitwegId: c.leitwegId ?? null,
        vatId: c.vatId ?? null,
        notes: c.notes ?? null,
      });
      const channelsChanged = await this.syncChannels(id, c.channels);
      counts[action === "unchanged" && channelsChanged ? "updated" : action]++;
      if (action === "unchanged" && channelsChanged) {
        this.event("contact", id, c.externalId, "updated");
      }
    }
    return counts;
  }

  /** Ersetzt die Kanäle eines Kontakts, falls sie sich geändert haben. */
  private async syncChannels(
    contactId: string,
    channels: ImportBatch["contacts"][number]["channels"],
  ): Promise<boolean> {
    const wanted = dedupeBy(
      channels.map((ch) => ({
        contactId,
        kind: ch.kind,
        value: ch.value,
        normalizedValue: normalizeChannelValue(ch.kind, ch.value),
        label: ch.label ?? null,
        isPrimary: ch.isPrimary ?? false,
      })),
      (ch) => `${ch.kind}|${ch.normalizedValue}`,
    );
    const existing = await this.tx
      .select()
      .from(contactChannels)
      .where(eq(contactChannels.contactId, contactId));
    const sig = (
      list: { kind: string; value: string; label: string | null; isPrimary: boolean }[],
    ) =>
      list
        .map((ch) => `${ch.kind}|${ch.value}|${ch.label ?? ""}|${ch.isPrimary}`)
        .sort()
        .join("\n");
    if (sig(existing) === sig(wanted)) return false;
    await this.tx.delete(contactChannels).where(eq(contactChannels.contactId, contactId));
    if (wanted.length > 0) await this.tx.insert(contactChannels).values(wanted);
    return true;
  }

  async importObjects(items: ImportBatch["objects"]): Promise<Counts> {
    const counts = emptyCounts();
    for (const o of items) {
      const roles = o.roles
        .map((r, i) => ({
          contactId: this.resolve(
            "contact",
            r.contactExternalId,
            `objects[${o.externalId}].roles[${i}]`,
          ),
          role: r.role,
        }))
        .filter((r): r is { contactId: string; role: typeof r.role } => r.contactId !== null);

      const { id, action } = await this.upsert(objects, "object", o.externalId, {
        label: o.label,
        street: o.street ?? null,
        postalCode: o.postalCode ?? null,
        city: o.city ?? null,
        country: o.country ?? "DE",
        usage: o.usage ?? "unbekannt",
        buildingType: o.buildingType ?? null,
        constructionYear: o.constructionYear ?? null,
        heatedAreaM2: o.heatedAreaM2 == null ? null : String(o.heatedAreaM2),
        units: o.units ?? null,
        storagePath: o.storagePath ?? null,
        notes: o.notes ?? null,
      });

      const rolesChanged = await this.syncRoles(id, roles);
      counts[action === "unchanged" && rolesChanged ? "updated" : action]++;
      if (action === "unchanged" && rolesChanged) {
        this.event("object", id, o.externalId, "updated");
      }
    }
    return counts;
  }

  private async syncRoles(
    objectId: string,
    roles: { contactId: string; role: (typeof objectRoles.$inferInsert)["role"] }[],
  ): Promise<boolean> {
    const wanted = dedupeBy(
      roles.map((r) => ({ objectId, contactId: r.contactId, role: r.role })),
      (r) => `${r.contactId}|${r.role}`,
    );
    const existing = await this.tx
      .select()
      .from(objectRoles)
      .where(eq(objectRoles.objectId, objectId));
    const sig = (list: { contactId: string; role: string }[]) =>
      list
        .map((r) => `${r.contactId}|${r.role}`)
        .sort()
        .join("\n");
    if (sig(existing) === sig(wanted)) return false;
    await this.tx.delete(objectRoles).where(eq(objectRoles.objectId, objectId));
    if (wanted.length > 0) await this.tx.insert(objectRoles).values(wanted);
    return true;
  }

  async importCases(items: ImportBatch["cases"]): Promise<Counts> {
    const counts = emptyCounts();
    await this.ensureMeasureTypes(items);
    for (const c of items) {
      const path = `cases[${c.externalId}]`;
      const customerId = this.resolve(
        "contact",
        c.customerExternalId,
        `${path}.customerExternalId`,
      );
      const objectId = this.resolveOptional(
        "object",
        c.objectExternalId,
        `${path}.objectExternalId`,
      );
      if (!customerId) continue;
      const { action } = await this.upsert(cases, "case", c.externalId, {
        number: c.number,
        title: c.title,
        customerId,
        objectId,
        measureCode: c.measureCode ?? null,
        status: c.status,
        openedAt: c.openedAt ?? null,
        closedAt: c.closedAt ?? null,
        storagePath: c.storagePath ?? null,
        notes: c.notes ?? null,
      });
      counts[action]++;
    }
    return counts;
  }

  /** Legt unbekannte Leistungsarten an; vorhandene werden nicht überschrieben. */
  private async ensureMeasureTypes(items: ImportBatch["cases"]) {
    const wanted = new Map<string, string>();
    for (const c of items) {
      if (c.measureCode && !wanted.has(c.measureCode)) {
        wanted.set(c.measureCode, c.measureName ?? c.measureCode);
      }
    }
    if (wanted.size === 0) return;
    await this.tx
      .insert(measureTypes)
      .values([...wanted].map(([code, name]) => ({ code, name })))
      .onConflictDoNothing();
  }

  async importDocuments(items: ImportBatch["documents"]): Promise<Counts> {
    const counts = emptyCounts();
    for (const d of items) {
      const path = `documents[${d.externalId}]`;
      const { action } = await this.upsert(documents, "document", d.externalId, {
        caseId: this.resolveOptional("case", d.caseExternalId, `${path}.caseExternalId`),
        objectId: this.resolveOptional("object", d.objectExternalId, `${path}.objectExternalId`),
        contactId: this.resolveOptional(
          "contact",
          d.contactExternalId,
          `${path}.contactExternalId`,
        ),
        title: d.title,
        docClass: d.docClass ?? null,
        storage: d.storage,
        location: d.location,
        mimeType: d.mimeType ?? null,
        sha256: d.sha256 ?? null,
      });
      counts[action]++;
    }
    return counts;
  }

  async importCommunications(items: ImportBatch["communications"]): Promise<Counts> {
    const counts = emptyCounts();
    for (const m of items) {
      const path = `communications[${m.externalId}]`;
      const { action } = await this.upsert(communications, "communication", m.externalId, {
        caseId: this.resolveOptional("case", m.caseExternalId, `${path}.caseExternalId`),
        contactId: this.resolveOptional(
          "contact",
          m.contactExternalId,
          `${path}.contactExternalId`,
        ),
        objectId: this.resolveOptional("object", m.objectExternalId, `${path}.objectExternalId`),
        channel: m.channel,
        direction: m.direction,
        occurredAt: new Date(m.occurredAt),
        subject: m.subject ?? null,
        body: m.body ?? null,
        author: m.author ?? null,
        matchConfidence: null,
        assignmentStatus: m.caseExternalId ? "bestaetigt" : "offen",
      });
      counts[action]++;
    }
    return counts;
  }

  async importBillingDocuments(items: ImportBatch["billingDocuments"]): Promise<Counts> {
    const counts = emptyCounts();
    for (const b of items) {
      const path = `billingDocuments[${b.externalId}]`;
      const contactId = this.resolve("contact", b.contactExternalId, `${path}.contactExternalId`);
      if (!contactId) continue;
      const { action } = await this.upsert(billingDocuments, "billing_document", b.externalId, {
        type: b.type,
        number: b.number ?? null,
        caseId: this.resolveOptional("case", b.caseExternalId, `${path}.caseExternalId`),
        contactId,
        issueDate: b.issueDate ?? null,
        dueDate: b.dueDate ?? null,
        currency: b.currency ?? "EUR",
        netCents: b.netCents,
        taxCents: b.taxCents,
        grossCents: b.grossCents,
        status: b.status,
        // Importierte Belege sind Archivkopien aus dem Vorsystem und werden hier nicht festgeschrieben.
        source: "import",
        pdfDocumentId: this.resolveOptional(
          "document",
          b.pdfDocumentExternalId,
          `${path}.pdfDocumentExternalId`,
        ),
      });
      counts[action]++;
    }
    return counts;
  }
}

function refKey(type: string, externalId: string) {
  return `${type}\u0000${externalId}`;
}

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
}

/** Vergleicht nur die zu schreibenden Felder; Datums-/Zahlendarstellungen werden normalisiert. */
function isSame(existing: Record<string, unknown>, values: Record<string, unknown>): boolean {
  return Object.entries(values).every(([k, v]) => normalize(existing[k]) === normalize(v));
}

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** Für Tests/Diagnose: interne ID zu einer externen Referenz. */
export async function lookupRef(
  db: Database,
  source: string,
  type: EntityType,
  externalId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: externalRefs.entityId })
    .from(externalRefs)
    .where(
      and(
        eq(externalRefs.source, source),
        eq(externalRefs.externalType, type),
        eq(externalRefs.externalId, externalId),
      ),
    );
  return row?.id;
}
