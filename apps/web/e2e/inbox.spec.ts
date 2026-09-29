import { expect, test } from "@playwright/test";
import { apiClient, apiJson, login, uniq } from "./helpers";

test("Inbox: unbekannte Nachricht einem Vorgang zuordnen und Kanal lernen", async ({ page }) => {
  const id = uniq();
  const api = await apiClient();
  const contact = await apiJson<{ id: string }>(api, "post", "contacts", {
    kind: "person",
    firstName: "Erika",
    lastName: `Beispiel ${id}`,
  });
  const kase = await apiJson<{ id: string; number: string }>(api, "post", "cases", {
    title: `Sanierungsfahrplan ${id}`,
    customerId: contact.id,
  });
  await apiJson(api, "post", "communications/ingest", {
    messages: [
      {
        source: "e2e-postfach",
        sourceRef: `msg-${id}`,
        channel: "email",
        direction: "eingehend",
        occurredAt: new Date().toISOString(),
        subject: `Frage zu Unterlagen ${id}`,
        body: "Guten Tag, anbei meine Frage.",
        participants: [
          { role: "from", address: `erika.${id}@example.org`, name: "Erika Beispiel" },
        ],
      },
    ],
  });

  await login(page);
  await page.goto("/inbox");
  const msg = page.getByTestId("inbox-message").filter({ hasText: `Frage zu Unterlagen ${id}` });
  await expect(msg).toBeVisible();
  await msg.getByLabel("Vorgang zuordnen").fill(id);
  await msg.getByRole("option", { name: new RegExp(`Sanierungsfahrplan ${id}`) }).click();
  await msg.getByLabel("Kanal lernen").check();
  await msg.getByRole("button", { name: "Zuordnen" }).click();
  await expect(page.getByRole("status")).toContainText("Zugeordnet.");
  await expect(
    page.getByTestId("inbox-message").filter({ hasText: `Frage zu Unterlagen ${id}` }),
  ).toHaveCount(0);

  const detail = await apiJson<{ communications: { subject: string }[] }>(
    api,
    "get",
    `cases/${kase.id}`,
  );
  expect(detail.communications.map((c) => c.subject)).toContain(`Frage zu Unterlagen ${id}`);
  const learned = await apiJson<{ channels: { value: string }[] }>(
    api,
    "get",
    `contacts/${contact.id}`,
  );
  expect(learned.channels.map((c) => c.value)).toContain(`erika.${id}@example.org`);

  // Nachricht erscheint im Vorgang
  await page.goto(`/vorgaenge/${kase.id}`);
  await expect(page.locator("#nachrichten")).toContainText(`Frage zu Unterlagen ${id}`);
});

test("Inbox: Neuanfrage aus Nachricht anlegen", async ({ page }) => {
  const id = uniq();
  const api = await apiClient();
  await apiJson(api, "post", "communications/ingest", {
    messages: [
      {
        source: "e2e-postfach",
        sourceRef: `lead-${id}`,
        channel: "email",
        direction: "eingehend",
        occurredAt: new Date().toISOString(),
        subject: `Anfrage Energieberatung ${id}`,
        participants: [{ role: "from", address: `lead.${id}@example.org`, name: "Moritz Probe" }],
      },
    ],
  });
  await login(page);
  await page.goto("/inbox");
  const msg = page
    .getByTestId("inbox-message")
    .filter({ hasText: `Anfrage Energieberatung ${id}` });
  await msg.getByRole("button", { name: "Neue Anfrage anlegen" }).click();
  await expect(msg.getByLabel("Nachname")).toHaveValue("Probe");
  await msg.getByRole("button", { name: "Anfrage anlegen" }).click();
  await expect(page.getByRole("status")).toContainText("Anfrage angelegt.");
  await page.getByRole("link", { name: "Zum Vorgang" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    `Anfrage Energieberatung ${id}`,
  );
});
