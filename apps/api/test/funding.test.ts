import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb, setupTestDb, testClient } from "./helpers.js";

const { db, close } = setupTestDb();
const client = testClient(db);

beforeEach(() => resetDb(db));
afterAll(() => close());

async function createCaseWithCustomer() {
  const contact = await client.post("/api/v1/contacts", {
    kind: "person",
    firstName: "Erika",
    lastName: "Beispiel",
  });
  expect(contact.status).toBe(201);
  await client.app.request("/api/v1/measure-types/EM", {
    method: "PUT",
    headers: { authorization: "Bearer test-token-123456", "content-type": "application/json" },
    body: JSON.stringify({ name: "Einzelmaßnahme" }),
  });
  const kase = await client.post("/api/v1/cases", {
    title: "Fenstertausch",
    customerId: contact.json.id,
    measureCode: "EM",
  });
  expect(kase.status).toBe(201);
  return kase.json.id as string;
}

const titles = (list: { title: string }[]) => list.map((d) => d.title).sort();

describe("Förderfall und Fristen", () => {
  it("liefert die mitgelieferten Programme und Regeln", async () => {
    const programs = await client.get("/api/v1/funding-programs");
    expect(programs.json.items.map((p: { code: string }) => p.code)).toContain("beg_em_bafa");
    const rules = await client.get("/api/v1/deadline-rules");
    expect(rules.json.items.length).toBeGreaterThanOrEqual(9);
    expect(rules.json.items.every((r: { sourceNote: string | null }) => r.sourceNote)).toBe(true);
  });

  it("berechnet Fristen aus Zusage, Standardzeitraum und Folgefristen", async () => {
    const caseId = await createCaseWithCustomer();
    const res = await client.post(`/api/v1/cases/${caseId}/funding-cases`, {
      programCode: "beg_em_bafa",
      guideline: "2026-07-21",
      approvedAt: "2026-08-31",
    });
    expect(res.status).toBe(201);
    const byTitle = Object.fromEntries(
      res.json.deadlines.map((d: { title: string; dueDate: string; remindFrom: string }) => [
        d.title,
        d,
      ]),
    );
    // 36 Monate ab Zusage; 31.08. → Monatsende Februar nicht betroffen, August hat 31 Tage
    expect(byTitle["Ende Bewilligungszeitraum – Maßnahme abschließen"].dueDate).toBe("2029-08-31");
    expect(byTitle["Ende Bewilligungszeitraum – Maßnahme abschließen"].remindFrom).toBe(
      "2029-06-02",
    );
    // + 6 Monate → 28.02.2030 (Monatsletzter)
    expect(byTitle["Verwendungsnachweis einreichen"].dueDate).toBe("2030-02-28");
    expect(res.json.deadlines).toHaveLength(2);
  });

  it("führt Fristen bei Änderungen nach und erledigt sie über doneWhen", async () => {
    const caseId = await createCaseWithCustomer();
    const created = await client.post(`/api/v1/cases/${caseId}/funding-cases`, {
      programCode: "beg_em_bafa",
      approvedAt: "2026-01-15",
    });
    const id = created.json.id;

    // Bescheid nennt abweichendes Ende → hat Vorrang vor dem Standard
    let res = await patch(`/api/v1/funding-cases/${id}`, { approvalValidUntil: "2028-12-31" });
    expect(res.status).toBe(200);
    const end = res.json.deadlines.find((d: { title: string }) => d.title.startsWith("Ende"));
    expect(end.dueDate).toBe("2028-12-31");

    // Maßnahme abgeschlossen, TPN erstellt → Bewilligungsfrist erledigt, TPN-Frist neu
    res = await patch(`/api/v1/funding-cases/${id}`, {
      measureCompletedAt: "2027-03-01",
      tpnCreatedAt: "2027-03-10",
    });
    expect(titles(res.json.deadlines)).toEqual([
      "Ende Bewilligungszeitraum – Maßnahme abschließen",
      "TPN-ID läuft ab",
      "Verwendungsnachweis einreichen",
    ]);
    const status = Object.fromEntries(
      res.json.deadlines.map((d: { title: string; status: string; dueDate: string }) => [
        d.title,
        `${d.status} ${d.dueDate}`,
      ]),
    );
    expect(status["Ende Bewilligungszeitraum – Maßnahme abschließen"]).toBe("erledigt 2028-12-31");
    expect(status["TPN-ID läuft ab"]).toBe("offen 2027-05-10");

    // Nachweis eingereicht → alles erledigt
    res = await patch(`/api/v1/funding-cases/${id}`, { proofSubmittedAt: "2027-04-01" });
    expect(res.json.deadlines.every((d: { status: string }) => d.status === "erledigt")).toBe(true);

    // Anker entfernt → offene Regelfrist verschwindet, erledigte bleibt
    res = await patch(`/api/v1/funding-cases/${id}`, {
      tpnCreatedAt: null,
      proofSubmittedAt: null,
    });
    expect(titles(res.json.deadlines)).toEqual([
      "Ende Bewilligungszeitraum – Maßnahme abschließen",
      "Verwendungsnachweis einreichen",
    ]);
  });

  it("wendet neue Regeln rückwirkend auf bestehende Förderfälle an", async () => {
    const caseId = await createCaseWithCustomer();
    const fc = await client.post(`/api/v1/cases/${caseId}/funding-cases`, {
      programCode: "beg_em_bafa",
      appliedAt: "2026-09-01",
    });
    expect(fc.json.deadlines).toHaveLength(0);
    const rule = await client.post("/api/v1/deadline-rules", {
      programCode: "beg_em_bafa",
      anchor: "applied_at",
      offsetDays: 42,
      leadDays: 7,
      doneWhen: "approved_at",
      title: "Nachfassen: Zusage ausstehend",
    });
    expect(rule.status).toBe(201);
    const after = await client.get(`/api/v1/funding-cases/${fc.json.id}`);
    expect(after.json.deadlines).toEqual([
      expect.objectContaining({ title: "Nachfassen: Zusage ausstehend", dueDate: "2026-10-13" }),
    ]);

    // Regel deaktivieren → offene Frist entfällt
    await patch(`/api/v1/deadline-rules/${rule.json.id}`, { active: false });
    const again = await client.get(`/api/v1/funding-cases/${fc.json.id}`);
    expect(again.json.deadlines).toHaveLength(0);
  });

  it("lehnt unbekannte Programme ab", async () => {
    const caseId = await createCaseWithCustomer();
    const res = await client.post(`/api/v1/cases/${caseId}/funding-cases`, {
      programCode: "gibtsnicht",
    });
    expect(res.status).toBe(422);
  });

  it("liefert einen Fristen-Digest und verwaltet Wiedervorlagen", async () => {
    const caseId = await createCaseWithCustomer();
    await client.post("/api/v1/deadlines", {
      caseId,
      title: "Kunde anrufen",
      dueDate: "2026-10-01",
    });
    await client.post("/api/v1/deadlines", { title: "Überfällig", dueDate: "2026-09-01" });
    await client.post("/api/v1/deadlines", {
      title: "Später mit Vorlauf",
      dueDate: "2026-12-01",
      remindFrom: "2026-09-20",
    });
    await client.post("/api/v1/deadlines", { title: "Ganz später", dueDate: "2027-06-01" });

    const digest = await client.get("/api/v1/deadlines/digest?days=14&today=2026-09-29");
    expect(titles(digest.json.overdue)).toEqual(["Überfällig"]);
    expect(titles(digest.json.dueSoon)).toEqual(["Kunde anrufen"]);
    expect(titles(digest.json.reminders)).toEqual(["Später mit Vorlauf"]);
    expect(digest.json.dueSoon[0].caseNumber).toMatch(/^EM-/);

    const done = await patch(`/api/v1/deadlines/${digest.json.overdue[0].id}`, {
      status: "erledigt",
    });
    expect(done.json.status).toBe("erledigt");
    expect(done.json.completedAt).not.toBeNull();
  });
});

async function patch(path: string, body: unknown) {
  const res = await client.app.request(path, {
    method: "PATCH",
    headers: { authorization: "Bearer test-token-123456", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
