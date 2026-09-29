import { sql } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { createDb, type Database } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

export const TOKEN = "test-token-123456";

export function setupTestDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL fehlt");
  return createDb(url);
}

/** Setzt die Test-Datenbank vollständig zurück und spielt alle Migrationen neu ein. */
export async function resetDb(db: Database) {
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await runMigrations(db);
}

export function testClient(db: Database) {
  const app = createApp({ db, apiToken: TOKEN });
  const request = async (method: string, path: string, body?: unknown, token = TOKEN) => {
    const res = await app.request(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: Testhelfer, Antworten werden im Test geprüft
    const json: any = text ? JSON.parse(text) : undefined;
    return { status: res.status, json };
  };
  return {
    app,
    get: (path: string, token?: string) => request("GET", path, undefined, token),
    post: (path: string, body: unknown, token?: string) => request("POST", path, body, token),
    patch: (path: string, body: unknown, token?: string) => request("PATCH", path, body, token),
    put: (path: string, body: unknown, token?: string) => request("PUT", path, body, token),
    del: (path: string, token?: string) => request("DELETE", path, undefined, token),
  };
}

/** Synthetischer Beispieldatenbestand (keine echten Personen). */
export function sampleBatch(overrides: Record<string, unknown> = {}) {
  return {
    source: "testsystem",
    contacts: [
      {
        externalId: "k1",
        kind: "person",
        salutation: "Herr",
        firstName: "Max",
        lastName: "Muster",
        customerNumber: "1001",
        street: "Musterweg 1",
        postalCode: "12345",
        city: "Musterstadt",
        channels: [
          { kind: "email", value: "Max.Muster@example.org", isPrimary: true },
          { kind: "mobile", value: "0170 1234567" },
        ],
      },
      {
        externalId: "k2",
        kind: "organisation",
        organisationName: "Gemeinde Beispielhausen",
        customerNumber: "1002",
        leitwegId: "991-12345-67",
        channels: [{ kind: "email", value: "bauamt@beispielhausen.example" }],
      },
    ],
    objects: [
      {
        externalId: "o1",
        label: "EFH Musterweg 1",
        street: "Musterweg 1",
        postalCode: "12345",
        city: "Musterstadt",
        usage: "wohngebaeude",
        buildingType: "EFH",
        constructionYear: 1968,
        heatedAreaM2: 142.5,
        roles: [{ contactExternalId: "k1", role: "eigentuemer" }],
      },
      {
        externalId: "o2",
        label: "Grundschule Beispielhausen",
        city: "Beispielhausen",
        usage: "nichtwohngebaeude",
        buildingType: "Schule",
        roles: [{ contactExternalId: "k2", role: "eigentuemer" }],
      },
    ],
    cases: [
      {
        externalId: "p1",
        number: "ISFP-001",
        title: "iSFP Musterweg 1",
        customerExternalId: "k1",
        objectExternalId: "o1",
        measureCode: "ISFP",
        measureName: "Individueller Sanierungsfahrplan",
        status: "abgeschlossen",
        openedAt: "2026-02-01",
        closedAt: "2026-04-15",
      },
      {
        externalId: "p2",
        number: "EM-002",
        title: "Einzelmaßnahme Fenster Musterweg 1",
        customerExternalId: "k1",
        objectExternalId: "o1",
        measureCode: "EM",
        status: "in_bearbeitung",
        openedAt: "2026-05-01",
      },
      {
        externalId: "p3",
        number: "NWG-003",
        title: "Energieberatung Grundschule",
        customerExternalId: "k2",
        objectExternalId: "o2",
        measureCode: "NWG",
        status: "angebot",
      },
    ],
    communications: [
      {
        externalId: "m1",
        caseExternalId: "p2",
        contactExternalId: "k1",
        channel: "email",
        direction: "eingehend",
        occurredAt: "2026-05-02T09:30:00+02:00",
        subject: "Angebot Fenster",
        body: "Anbei das Angebot des Fensterbauers.",
      },
      {
        externalId: "m2",
        channel: "whatsapp",
        direction: "eingehend",
        occurredAt: "2026-05-03T18:00:00+02:00",
        body: "Neue Anfrage ohne Zuordnung",
      },
    ],
    documents: [
      {
        externalId: "d1",
        caseExternalId: "p1",
        title: "Rechnung RE-2026-001.pdf",
        docClass: "rechnung",
        storage: "nextcloud",
        location: "/Projekte/ISFP-001/RE-2026-001.pdf",
        mimeType: "application/pdf",
      },
    ],
    billingDocuments: [
      {
        externalId: "b1",
        type: "rechnung",
        number: "RE-2026-001",
        caseExternalId: "p1",
        contactExternalId: "k1",
        issueDate: "2026-04-15",
        netCents: 100840,
        taxCents: 19160,
        grossCents: 120000,
        status: "versendet",
        pdfDocumentExternalId: "d1",
      },
    ],
    ...overrides,
  };
}
