import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, setupTestDb, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeEach(async () => {
  await resetDb(db);
  await client.put("/api/v1/settings/communication", {
    ownAddresses: ["info@beratung.example", "+49 6061 99999"],
    ignoredAddresses: ["newsletter@shop.example"],
  });
});
afterAll(() => close());

async function setup() {
  const customer = await client.post("/api/v1/contacts", {
    kind: "person",
    firstName: "Max",
    lastName: "Muster",
    channels: [
      { kind: "email", value: "max@example.org" },
      { kind: "mobile", value: "0170 1234567" },
    ],
  });
  const obj = await client.post("/api/v1/objects", {
    label: "EFH Hauptstraße 12",
    street: "Hauptstraße 12",
    city: "Musterstadt",
    roles: [{ contactId: customer.json.id, role: "eigentuemer" }],
  });
  const kase = await client.post("/api/v1/cases", {
    number: "ISFP-311",
    title: "iSFP Hauptstraße",
    customerId: customer.json.id,
    objectId: obj.json.id,
  });
  return { customerId: customer.json.id as string, caseId: kase.json.id as string };
}

const mail = (over: Record<string, unknown>) => ({
  source: "postfach-info",
  sourceRef: `msg-${Math.random()}`,
  channel: "email",
  direction: "eingehend",
  occurredAt: "2026-09-29T08:15:00+02:00",
  subject: "Unterlagen",
  body: "Hallo, anbei die Unterlagen.",
  participants: [
    { role: "from", address: "Max@Example.org", name: "Max Muster" },
    { role: "to", address: "info@beratung.example" },
  ],
  ...over,
});

describe("Kommunikation", () => {
  it("ordnet eingehende Mails automatisch zu und dedupliziert", async () => {
    const { caseId } = await setup();
    const msg = mail({
      sourceRef: "<abc@example.org>",
      attachments: [
        { title: "Grundriss.pdf", storage: "nextcloud", location: "/Eingang/Grundriss.pdf" },
      ],
    });
    const res = await client.post("/api/v1/communications/ingest", { messages: [msg, msg] });
    expect(res.status).toBe(200);
    expect(res.json.items[0]).toMatchObject({
      duplicate: false,
      assignmentStatus: "automatisch",
      caseNumber: "ISFP-311",
    });
    expect(res.json.items[1].duplicate).toBe(true);

    const detail = await client.get(`/api/v1/cases/${caseId}`);
    expect(detail.json.communications).toHaveLength(1);
    expect(detail.json.documents.map((d: { title: string }) => d.title)).toEqual(["Grundriss.pdf"]);

    const inbox = await client.get("/api/v1/communications/inbox");
    expect(inbox.json.automatic).toHaveLength(1);
    const confirmed = await client.post(
      `/api/v1/communications/${inbox.json.automatic[0].id}/confirm`,
      {},
    );
    expect(confirmed.json.assignmentStatus).toBe("bestaetigt");
  });

  it("ordnet ausgehende WhatsApp über die Empfängernummer zu", async () => {
    await setup();
    const res = await client.post("/api/v1/communications/ingest", {
      messages: [
        mail({
          channel: "whatsapp",
          direction: "ausgehend",
          subject: null,
          body: "Termin morgen 10 Uhr?",
          participants: [
            { role: "from", address: "+49 6061 99999" },
            { role: "to", address: "+49 170 1234567" },
          ],
        }),
      ],
    });
    expect(res.json.items[0]).toMatchObject({
      assignmentStatus: "automatisch",
      caseNumber: "ISFP-311",
    });
  });

  it("legt Unbekanntes in die Inbox, lernt Kanäle und ordnet neu zu", async () => {
    const { customerId, caseId } = await setup();
    const unknown = mail({
      participants: [{ role: "from", address: "max.privat@example.net" }],
      subject: "Frage zum Termin",
    });
    await client.post("/api/v1/communications/ingest", { messages: [unknown] });
    const inbox = await client.get("/api/v1/communications/inbox");
    expect(inbox.json.open).toHaveLength(1);
    const id = inbox.json.open[0].id;

    // Zweite Nachricht derselben Adresse, dann manuell zuordnen und lernen
    await client.post("/api/v1/communications/ingest", {
      messages: [mail({ participants: [{ role: "from", address: "max.privat@example.net" }] })],
    });
    const assigned = await client.post(`/api/v1/communications/${id}/assign`, {
      caseId,
      learnChannel: true,
    });
    expect(assigned.json).toMatchObject({ assignmentStatus: "bestaetigt", contactId: customerId });

    const contact = await client.get(`/api/v1/contacts/${customerId}`);
    expect(contact.json.channels.map((c: { value: string }) => c.value)).toContain(
      "max.privat@example.net",
    );

    const rematch = await client.post("/api/v1/communications/rematch", {});
    expect(rematch.json).toEqual({ checked: 1, assigned: 1 });
    const after = await client.get("/api/v1/communications/inbox");
    expect(after.json.open).toHaveLength(0);
  });

  it("ignoriert Adressen auf der Ignorierliste", async () => {
    await setup();
    const res = await client.post("/api/v1/communications/ingest", {
      messages: [mail({ participants: [{ role: "from", address: "newsletter@shop.example" }] })],
    });
    expect(res.json.items[0].assignmentStatus).toBe("ignoriert");
  });

  it("macht aus einer Neuanfrage Kontakt und Vorgang", async () => {
    await client.put("/api/v1/measure-types/EM", { name: "Einzelmaßnahme" });
    await client.post("/api/v1/communications/ingest", {
      messages: [
        mail({
          channel: "whatsapp",
          subject: null,
          body: "Hallo, wir brauchen Beratung zur Wärmepumpe.",
          participants: [{ role: "from", address: "+49 151 7654321", name: "Neukunde" }],
        }),
      ],
    });
    const inbox = await client.get("/api/v1/communications/inbox");
    const id = inbox.json.open[0].id;
    const lead = await client.post(`/api/v1/communications/${id}/lead`, {
      contact: { kind: "person", firstName: "Nina", lastName: "Neu" },
      case: { title: "Anfrage Wärmepumpe", measureCode: "EM" },
    });
    expect(lead.status).toBe(201);
    expect(lead.json.communication).toMatchObject({
      assignmentStatus: "bestaetigt",
      contactName: "Nina Neu",
    });
    const kase = await client.get(`/api/v1/cases/${lead.json.caseId}`);
    expect(kase.json).toMatchObject({ status: "anfrage", number: "EM-1" });
    const contact = await client.get(`/api/v1/contacts/${lead.json.contactId}`);
    expect(contact.json.channels).toEqual([
      expect.objectContaining({ kind: "whatsapp", value: "+49 151 7654321" }),
    ]);

    // Folgenachricht derselben Nummer wird jetzt automatisch zugeordnet
    const next = await client.post("/api/v1/communications/ingest", {
      messages: [
        mail({ channel: "whatsapp", participants: [{ role: "from", address: "0151/7654321" }] }),
      ],
    });
    expect(next.json.items[0].caseNumber).toBe("EM-1");
  });

  it("liefert eine Chronik aus Nachrichten und Ereignissen", async () => {
    const { caseId } = await setup();
    await client.post("/api/v1/communications/ingest", { messages: [mail({})] });
    await client.patch(`/api/v1/cases/${caseId}`, { status: "beauftragt" });
    const tl = await client.get(`/api/v1/timeline?caseId=${caseId}`);
    const types = tl.json.items.map((i: { type: string }) => i.type);
    expect(types).toEqual(
      expect.arrayContaining(["communication.eingehend", "case.created", "case.status_changed"]),
    );
    const status = tl.json.items.find((i: { type: string }) => i.type === "case.status_changed");
    expect(status.detail).toBe("status: anfrage → beauftragt");
    expect((await client.get("/api/v1/timeline")).status).toBe(400);
  });
});
