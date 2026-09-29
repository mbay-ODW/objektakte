import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const address = {
  street: text("street"),
  postalCode: text("postal_code"),
  city: text("city"),
  country: text("country").notNull().default("DE"),
};

// ---------------------------------------------------------------------------
// Kontakte
// ---------------------------------------------------------------------------

export const contactKind = pgEnum("contact_kind", ["person", "organisation"]);

export const channelKind = pgEnum("channel_kind", [
  "email",
  "phone",
  "mobile",
  "whatsapp",
  "signal",
  "fax",
  "website",
]);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: contactKind("kind").notNull(),
    displayName: text("display_name").notNull(),
    salutation: text("salutation"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    organisationName: text("organisation_name"),
    customerNumber: text("customer_number"),
    ...address,
    /** Leitweg-ID öffentlicher Auftraggeber (Pflichtfeld für XRechnung). */
    leitwegId: text("leitweg_id"),
    vatId: text("vat_id"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("contacts_customer_number_uq").on(t.customerNumber),
    index("contacts_display_name_idx").on(sql`lower(${t.displayName})`),
  ],
);

export const contactChannels = pgTable(
  "contact_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    kind: channelKind("kind").notNull(),
    value: text("value").notNull(),
    /** Normalisierter Wert für die Zuordnung (E-Mail klein, Telefon nur Ziffern mit Ländervorwahl). */
    normalizedValue: text("normalized_value").notNull(),
    label: text("label"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("contact_channels_contact_kind_value_uq").on(
      t.contactId,
      t.kind,
      t.normalizedValue,
    ),
    index("contact_channels_lookup_idx").on(t.normalizedValue),
  ],
);

/** Ansprechpartner einer Organisation (z. B. Hausverwaltung → Sachbearbeiterin). */
export const contactPersons = pgTable(
  "contact_persons",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role"),
  },
  (t) => [primaryKey({ columns: [t.organisationId, t.personId] })],
);

// ---------------------------------------------------------------------------
// Objekte (Gebäude/Liegenschaften)
// ---------------------------------------------------------------------------

export const objectUsage = pgEnum("object_usage", [
  "wohngebaeude",
  "nichtwohngebaeude",
  "gemischt",
  "unbekannt",
]);

export const objectRole = pgEnum("object_role", [
  "eigentuemer",
  "verwaltung",
  "nutzer",
  "ansprechpartner",
  "handwerker",
  "planer",
  "sonstige",
]);

export const objects = pgTable(
  "objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    ...address,
    usage: objectUsage("usage").notNull().default("unbekannt"),
    /** Freitext-Gebäudetyp, z. B. EFH, MFH, Schule, Verwaltungsgebäude. */
    buildingType: text("building_type"),
    constructionYear: integer("construction_year"),
    heatedAreaM2: numeric("heated_area_m2", { precision: 10, scale: 2 }),
    units: integer("units"),
    /** Ordner in der Dateiablage (z. B. Nextcloud-Pfad). */
    storagePath: text("storage_path"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("objects_city_idx").on(t.city)],
);

export const objectRoles = pgTable(
  "object_roles",
  {
    objectId: uuid("object_id")
      .notNull()
      .references(() => objects.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: objectRole("role").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
  },
  (t) => [primaryKey({ columns: [t.objectId, t.contactId, t.role] })],
);

// ---------------------------------------------------------------------------
// Vorgänge
// ---------------------------------------------------------------------------

/** Leistungsarten (z. B. iSFP, Einzelmaßnahme, Energieaudit). Codes sind frei konfigurierbar. */
export const measureTypes = pgTable("measure_types", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
});

export const caseStatus = pgEnum("case_status", [
  "anfrage",
  "angebot",
  "beauftragt",
  "in_bearbeitung",
  "abrechnung",
  "abgeschlossen",
  "storniert",
]);

export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: text("number").notNull(),
    title: text("title").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    objectId: uuid("object_id").references(() => objects.id, { onDelete: "set null" }),
    measureCode: text("measure_code").references(() => measureTypes.code, {
      onDelete: "restrict",
    }),
    status: caseStatus("status").notNull().default("anfrage"),
    /** true = Status wurde manuell gesetzt und wird nicht automatisch abgeleitet. */
    statusOverridden: boolean("status_overridden").notNull().default(false),
    openedAt: date("opened_at"),
    closedAt: date("closed_at"),
    storagePath: text("storage_path"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("cases_number_uq").on(t.number),
    index("cases_customer_idx").on(t.customerId),
    index("cases_object_idx").on(t.objectId),
    index("cases_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Kommunikation (Timeline)
// ---------------------------------------------------------------------------

export const commChannel = pgEnum("comm_channel", [
  "email",
  "whatsapp",
  "signal",
  "telefon",
  "vor_ort",
  "brief",
  "notiz",
]);

export const commDirection = pgEnum("comm_direction", ["eingehend", "ausgehend", "intern"]);

export const communications = pgTable(
  "communications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    objectId: uuid("object_id").references(() => objects.id, { onDelete: "set null" }),
    channel: commChannel("channel").notNull(),
    direction: commDirection("direction").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    subject: text("subject"),
    body: text("body"),
    author: text("author"),
    /** Konfidenz der automatischen Zuordnung (0–1); null = manuell zugeordnet. */
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("communications_case_idx").on(t.caseId, t.occurredAt),
    index("communications_contact_idx").on(t.contactId, t.occurredAt),
    index("communications_unassigned_idx").on(t.occurredAt).where(sql`${t.caseId} is null`),
  ],
);

// ---------------------------------------------------------------------------
// Dokumente (nur Referenzen, die Dateien liegen in der Dateiablage)
// ---------------------------------------------------------------------------

export const documentStorage = pgEnum("document_storage", ["nextcloud", "paperless", "url"]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "set null" }),
    objectId: uuid("object_id").references(() => objects.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** Dokumentklasse, z. B. antrag, bescheid, bericht, foto, rechnung. */
    docClass: text("doc_class"),
    storage: documentStorage("storage").notNull(),
    location: text("location").notNull(),
    mimeType: text("mime_type"),
    sha256: text("sha256"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("documents_storage_location_uq").on(t.storage, t.location),
    index("documents_case_idx").on(t.caseId),
  ],
);

// ---------------------------------------------------------------------------
// Belege (Angebote, Rechnungen, …)
// ---------------------------------------------------------------------------

export const billingDocType = pgEnum("billing_doc_type", [
  "angebot",
  "auftragsbestaetigung",
  "rechnung",
  "abschlagsrechnung",
  "schlussrechnung",
  "stornorechnung",
  "gutschrift",
  "zahlungserinnerung",
  "zahlungsbestaetigung",
]);

export const billingDocStatus = pgEnum("billing_doc_status", [
  "entwurf",
  "festgeschrieben",
  "versendet",
  "storniert",
]);

export const billingDocSource = pgEnum("billing_doc_source", ["nativ", "import"]);

export const billingDocuments = pgTable(
  "billing_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: billingDocType("type").notNull(),
    /** Belegnummer; bei Entwürfen leer, wird beim Festschreiben vergeben. */
    number: text("number"),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "restrict" }),
    issueDate: date("issue_date"),
    dueDate: date("due_date"),
    currency: text("currency").notNull().default("EUR"),
    netCents: bigint("net_cents", { mode: "number" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull(),
    status: billingDocStatus("status").notNull().default("entwurf"),
    source: billingDocSource("source").notNull().default("nativ"),
    pdfDocumentId: uuid("pdf_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    /** SHA-256 über den festgeschriebenen Inhalt (GoBD-Nachweis). */
    contentHash: text("content_hash"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("billing_documents_number_uq").on(t.number),
    index("billing_documents_case_idx").on(t.caseId),
    index("billing_documents_contact_idx").on(t.contactId),
  ],
);

// ---------------------------------------------------------------------------
// Querschnitt: Fremdschlüssel aus Importen und Ereignisprotokoll
// ---------------------------------------------------------------------------

/**
 * Zuordnung externer IDs (aus Importen oder angebundenen Systemen) zu internen Datensätzen.
 * Macht Importe idempotent: gleiche (source, external_type, external_id) → gleicher Datensatz.
 */
export const externalRefs = pgTable(
  "external_refs",
  {
    source: text("source").notNull(),
    externalType: text("external_type").notNull(),
    externalId: text("external_id").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.source, t.externalType, t.externalId] }),
    index("external_refs_entity_idx").on(t.entityId),
  ],
);

/** Append-only-Ereignisprotokoll. UPDATE/DELETE werden per Trigger verhindert (siehe Migration). */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payload: jsonb("payload").notNull().default({}),
  },
  (t) => [
    index("events_entity_idx").on(t.entityType, t.entityId, t.id),
    index("events_type_idx").on(t.type, t.id),
  ],
);

// ---------------------------------------------------------------------------
// Förderung und Fristen
// ---------------------------------------------------------------------------

/** Förderprogramme (Stammdaten, frei erweiterbar). */
export const fundingPrograms = pgTable("funding_programs", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** Standard-Bewilligungszeitraum in Monaten ab Zusage (falls kein Datum im Bescheid). */
  approvalPeriodMonths: integer("approval_period_months"),
  active: boolean("active").notNull().default(true),
});

export const fundingCases = pgTable(
  "funding_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    programCode: text("program_code")
      .notNull()
      .references(() => fundingPrograms.code, { onDelete: "restrict" }),
    /** Richtlinienstand, z. B. "2023-12-21" oder "2026-07-21". */
    guideline: text("guideline"),
    applicationId: text("application_id"),
    tpbId: text("tpb_id"),
    tpbCreatedAt: date("tpb_created_at"),
    bzaCreatedAt: date("bza_created_at"),
    appliedAt: date("applied_at"),
    approvedAt: date("approved_at"),
    /** Ende des Bewilligungszeitraums laut Bescheid; leer = aus Programm-Standard berechnet. */
    approvalValidUntil: date("approval_valid_until"),
    measureCompletedAt: date("measure_completed_at"),
    tpnId: text("tpn_id"),
    tpnCreatedAt: date("tpn_created_at"),
    proofSubmittedAt: date("proof_submitted_at"),
    paidOutAt: date("paid_out_at"),
    isfpDate: date("isfp_date"),
    eligibleCostsCents: bigint("eligible_costs_cents", { mode: "number" }),
    approvedAmountCents: bigint("approved_amount_cents", { mode: "number" }),
    ratePercent: numeric("rate_percent", { precision: 5, scale: 2 }),
    bonuses: text("bonuses").array().notNull().default(sql`'{}'::text[]`),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("funding_cases_case_idx").on(t.caseId)],
);

/** Datumsfelder eines Förderfalls, an denen Fristenregeln ansetzen können. */
export const fundingAnchor = pgEnum("funding_anchor", [
  "tpb_created_at",
  "bza_created_at",
  "applied_at",
  "approved_at",
  "approval_valid_until",
  "measure_completed_at",
  "tpn_created_at",
  "proof_submitted_at",
  "isfp_date",
]);

/** Fristenregeln als Daten: Frist = Anker + Versatz; erledigt, sobald `done_when` gesetzt ist. */
export const deadlineRules = pgTable("deadline_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Programmcode oder "*" für alle Programme. */
  programCode: text("program_code").notNull(),
  /** Richtlinienstand; null = alle. */
  guideline: text("guideline"),
  anchor: fundingAnchor("anchor").notNull(),
  offsetMonths: integer("offset_months").notNull().default(0),
  offsetDays: integer("offset_days").notNull().default(0),
  /** Vorlauf für Erinnerungen in Tagen. */
  leadDays: integer("lead_days").notNull().default(30),
  doneWhen: fundingAnchor("done_when"),
  title: text("title").notNull(),
  description: text("description"),
  /** Quelle/Beleg der Regel (Richtlinie, Merkblatt …). */
  sourceNote: text("source_note"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const deadlineStatus = pgEnum("deadline_status", ["offen", "erledigt", "verworfen"]);

export const deadlines = pgTable(
  "deadlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id").references(() => cases.id, { onDelete: "cascade" }),
    fundingCaseId: uuid("funding_case_id").references(() => fundingCases.id, {
      onDelete: "cascade",
    }),
    ruleId: uuid("rule_id").references(() => deadlineRules.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    dueDate: date("due_date").notNull(),
    remindFrom: date("remind_from"),
    status: deadlineStatus("status").notNull().default("offen"),
    completedAt: date("completed_at"),
    /** true = durch die Regel (done_when) erledigt, nicht manuell; wird bei Wegfall wieder geöffnet. */
    completedByRule: boolean("completed_by_rule").notNull().default(false),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("deadlines_rule_uq")
      .on(t.fundingCaseId, t.ruleId)
      .where(sql`${t.ruleId} is not null`),
    index("deadlines_due_idx").on(t.status, t.dueDate),
    index("deadlines_case_idx").on(t.caseId),
  ],
);

// ---------------------------------------------------------------------------
// Webhooks (Verteilung des Ereignisprotokolls)
// ---------------------------------------------------------------------------

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  /** HMAC-SHA256-Schlüssel für die Signatur (Header X-Objektakte-Signature). */
  secret: text("secret").notNull(),
  /** Ereignistyp-Muster, z. B. "case.*", "deadline.*" oder "*". */
  eventTypes: text("event_types").array().notNull().default(sql`'{*}'::text[]`),
  active: boolean("active").notNull().default(true),
  /** Letzte erfolgreich zugestellte Ereignis-ID (Cursor). */
  lastEventId: bigint("last_event_id", { mode: "number" }).notNull().default(0),
  failures: integer("failures").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Nummernkreise (Vorgänge, später Belege)
// ---------------------------------------------------------------------------

/** Lückenlose Nummernkreise; Vergabe nur per SELECT … FOR UPDATE innerhalb einer Transaktion. */
export const numberSequences = pgTable("number_sequences", {
  key: text("key").primaryKey(),
  nextValue: bigint("next_value", { mode: "number" }).notNull().default(1),
  padding: integer("padding").notNull().default(0),
  ...timestamps,
});
