import { expect, test } from "@playwright/test";
import { login, uniq } from "./helpers";

test("Kontakt → Objekt → Vorgang → Förderfall mit berechneten Fristen", async ({ page }) => {
  const id = uniq();
  await login(page);

  // Leistungsart anlegen
  await page.goto("/einstellungen/leistungsarten");
  const newMeasure = page.locator("form", { has: page.getByRole("button", { name: "Anlegen" }) });
  await newMeasure.getByLabel("Kürzel").fill("EM");
  await newMeasure.getByLabel("Bezeichnung").fill("Einzelmaßnahme");
  await newMeasure.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByText("EM – Einzelmaßnahme")).toBeVisible();

  // Kontakt
  await page.goto("/kontakte/neu");
  await page.getByLabel("Vorname").fill("Max");
  await page.getByLabel("Nachname").fill(`Muster ${id}`);
  await page.getByLabel("Ort").fill("Musterstadt");
  await page.getByLabel("Adresse oder Nummer").fill(`max.${id}@example.org`);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("heading", { name: `Max Muster ${id}` })).toBeVisible();
  await expect(page.getByRole("link", { name: `max.${id}@example.org` })).toBeVisible();

  // Suche in der Kontaktliste
  await page.goto(`/kontakte?q=${id}`);
  await expect(page.getByRole("link", { name: `Max Muster ${id}` })).toBeVisible();

  // Objekt mit Eigentümer
  await page.goto("/objekte/neu");
  await page.getByLabel("Bezeichnung").fill(`EFH Musterweg ${id}`);
  await page.getByLabel("Straße").fill("Musterweg 1");
  await page.getByLabel("Ort").fill("Musterstadt");
  await page.getByLabel("Eigentümer (optional)").fill(id);
  await page.getByRole("option", { name: new RegExp(`Max Muster ${id}`) }).click();
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("heading", { name: `EFH Musterweg ${id}` })).toBeVisible();
  const roles = page.locator("section", { has: page.getByRole("heading", { name: "Beteiligte" }) });
  const owner = roles.getByRole("listitem").filter({ hasText: `Max Muster ${id}` });
  await expect(owner.locator(".badge")).toHaveText("Eigentümer");

  // Vorgang aus dem Objekt heraus (Objekt vorbelegt)
  await page.getByRole("link", { name: "Neuer Vorgang" }).click();
  await page.getByLabel("Titel").fill(`Fenstertausch ${id}`);
  await page.getByLabel("Kunde").fill(id);
  await page.getByRole("option", { name: new RegExp(`Max Muster ${id}`) }).click();
  await page.getByLabel("Leistungsart").selectOption("EM");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(`Fenstertausch ${id}`) }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("EM-");

  // Förderfall mit Zusagedatum → Fristen werden berechnet
  await page.getByRole("button", { name: "Neuer Förderfall" }).click();
  const form = page.locator("form.new-funding");
  await form.getByLabel("Förderprogramm").selectOption("beg_em_bafa");
  await form.getByLabel("Zusage").fill("2026-03-15");
  await form.getByLabel("Förderfähige Kosten (€)").fill("24.500,00");
  await form.getByRole("button", { name: "Förderfall anlegen" }).click();

  const funding = page.getByTestId("funding-case");
  await expect(funding).toContainText("BEG EM – Zuschuss BAFA");
  await expect(funding).toContainText("24.500,00");
  const deadlines = funding.getByTestId("funding-deadlines");
  // Ende Bewilligungszeitraum = Zusage + 36 Monate, Verwendungsnachweis + 6 Monate
  await expect(deadlines).toContainText("15.03.2029");
  await expect(deadlines).toContainText("15.09.2029");

  // Frist erledigen
  const fristen = page.locator("#fristen");
  await fristen.getByRole("button", { name: "Erledigt" }).first().click();
  await expect(fristen.locator(".badge.ok").first()).toHaveText("erledigt");

  // Wiedervorlage
  await fristen.getByText("Wiedervorlage anlegen").click();
  await fristen.getByLabel("Titel").fill(`Rückruf ${id}`);
  await fristen.getByLabel("Fällig am").fill("2026-12-01");
  await fristen.getByRole("button", { name: "Anlegen" }).click();
  await expect(fristen).toContainText(`Rückruf ${id}`);

  // Chronik zeigt den Förderfall
  await expect(page.locator("#chronik")).toContainText("Förderfall angelegt");

  // Kanban: Status per Formular ändern
  await page.goto("/vorgaenge?ansicht=board");
  const card = page.getByTestId("board-card").filter({ hasText: `Fenstertausch ${id}` });
  await card.getByLabel(/Status von/).selectOption("beauftragt");
  await card.getByRole("button", { name: "Verschieben" }).click();
  await expect(
    page.locator("section.column", { has: page.getByRole("heading", { name: /Beauftragt/ }) }),
  ).toContainText(`Fenstertausch ${id}`);
});
