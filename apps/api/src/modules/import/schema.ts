import { z } from "@hono/zod-openapi";

const externalId = z.string().min(1).max(200);
const isoDate = z.iso.date();
const optionalText = z.string().trim().min(1).nullish();

export const ImportChannel = z.object({
  kind: z.enum(["email", "phone", "mobile", "whatsapp", "signal", "fax", "website"]),
  value: z.string().trim().min(1),
  label: optionalText,
  isPrimary: z.boolean().optional(),
});

export const ImportContact = z
  .object({
    externalId,
    kind: z.enum(["person", "organisation"]),
    displayName: optionalText,
    salutation: optionalText,
    firstName: optionalText,
    lastName: optionalText,
    organisationName: optionalText,
    customerNumber: optionalText,
    street: optionalText,
    postalCode: optionalText,
    city: optionalText,
    country: z.string().length(2).optional(),
    leitwegId: optionalText,
    vatId: optionalText,
    notes: optionalText,
    channels: z.array(ImportChannel).default([]),
  })
  .openapi("ImportContact");

export const ImportObject = z
  .object({
    externalId,
    label: z.string().trim().min(1),
    street: optionalText,
    postalCode: optionalText,
    city: optionalText,
    country: z.string().length(2).optional(),
    usage: z.enum(["wohngebaeude", "nichtwohngebaeude", "gemischt", "unbekannt"]).optional(),
    buildingType: optionalText,
    constructionYear: z.number().int().min(1000).max(2100).nullish(),
    heatedAreaM2: z.number().positive().nullish(),
    units: z.number().int().positive().nullish(),
    storagePath: optionalText,
    notes: optionalText,
    roles: z
      .array(
        z.object({
          contactExternalId: externalId,
          role: z.enum([
            "eigentuemer",
            "verwaltung",
            "nutzer",
            "ansprechpartner",
            "handwerker",
            "planer",
            "sonstige",
          ]),
        }),
      )
      .default([]),
  })
  .openapi("ImportObject");

export const ImportCase = z
  .object({
    externalId,
    number: z.string().trim().min(1),
    title: z.string().trim().min(1),
    customerExternalId: externalId,
    objectExternalId: externalId.nullish(),
    measureCode: optionalText,
    measureName: optionalText,
    status: z.enum([
      "anfrage",
      "angebot",
      "beauftragt",
      "in_bearbeitung",
      "abrechnung",
      "abgeschlossen",
      "storniert",
    ]),
    openedAt: isoDate.nullish(),
    closedAt: isoDate.nullish(),
    storagePath: optionalText,
    notes: optionalText,
  })
  .openapi("ImportCase");

export const ImportCommunication = z
  .object({
    externalId,
    caseExternalId: externalId.nullish(),
    contactExternalId: externalId.nullish(),
    objectExternalId: externalId.nullish(),
    channel: z.enum(["email", "whatsapp", "signal", "telefon", "vor_ort", "brief", "notiz"]),
    direction: z.enum(["eingehend", "ausgehend", "intern"]),
    occurredAt: z.iso.datetime({ offset: true }),
    subject: optionalText,
    body: z.string().nullish(),
    author: optionalText,
  })
  .openapi("ImportCommunication");

export const ImportDocument = z
  .object({
    externalId,
    caseExternalId: externalId.nullish(),
    objectExternalId: externalId.nullish(),
    contactExternalId: externalId.nullish(),
    title: z.string().trim().min(1),
    docClass: optionalText,
    storage: z.enum(["nextcloud", "paperless", "url"]),
    location: z.string().trim().min(1),
    mimeType: optionalText,
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullish(),
  })
  .openapi("ImportDocument");

const cents = z.number().int();

export const ImportBillingDocument = z
  .object({
    externalId,
    type: z.enum([
      "angebot",
      "auftragsbestaetigung",
      "rechnung",
      "abschlagsrechnung",
      "schlussrechnung",
      "stornorechnung",
      "gutschrift",
      "zahlungserinnerung",
      "zahlungsbestaetigung",
    ]),
    number: optionalText,
    caseExternalId: externalId.nullish(),
    contactExternalId: externalId,
    issueDate: isoDate.nullish(),
    dueDate: isoDate.nullish(),
    currency: z.string().length(3).optional(),
    netCents: cents,
    taxCents: cents,
    grossCents: cents,
    status: z.enum(["entwurf", "festgeschrieben", "versendet", "storniert"]),
    pdfDocumentExternalId: externalId.nullish(),
  })
  .refine((b) => b.netCents + b.taxCents === b.grossCents, {
    message: "netCents + taxCents muss grossCents ergeben",
    path: ["grossCents"],
  })
  .openapi("ImportBillingDocument");

export const ImportBatch = z
  .object({
    /** Namensraum der externen IDs, z. B. "altsystem" oder "adressbuch-2026". */
    source: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, "nur a-z, 0-9, _ und -"),
    /** true = alles prüfen und zählen, aber nichts speichern. */
    dryRun: z.boolean().default(false),
    contacts: z.array(ImportContact).default([]),
    objects: z.array(ImportObject).default([]),
    cases: z.array(ImportCase).default([]),
    communications: z.array(ImportCommunication).default([]),
    documents: z.array(ImportDocument).default([]),
    billingDocuments: z.array(ImportBillingDocument).default([]),
  })
  .openapi("ImportBatch");

export type ImportBatch = z.infer<typeof ImportBatch>;

const Counts = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
});

export const ImportResult = z
  .object({
    dryRun: z.boolean(),
    contacts: Counts,
    objects: Counts,
    cases: Counts,
    communications: Counts,
    documents: Counts,
    billingDocuments: Counts,
  })
  .openapi("ImportResult");

export type ImportResult = z.infer<typeof ImportResult>;

export const ImportErrorResponse = z
  .object({
    error: z.literal("import_failed"),
    problems: z.array(z.object({ path: z.string(), message: z.string() })),
  })
  .openapi("ImportErrorResponse");
