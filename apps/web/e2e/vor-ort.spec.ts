import { expect, test } from "@playwright/test";
import { apiClient, apiJson, login, pngBuffer, uniq } from "./helpers";

interface InspectionDetail {
  id: string;
  status: string;
  protocolDocumentId: string | null;
  participants: { name: string; role?: string | null }[];
  items: {
    id: string;
    category: string;
    label: string;
    condition: string | null;
    attributes: Record<string, unknown>;
  }[];
  media: {
    id: string;
    itemId: string | null;
    kind: string;
    mimeType: string;
    documentId: string;
  }[];
}

test("Begehung offline erfassen, später synchronisieren und abschließen", async ({
  page,
  context,
}) => {
  const id = uniq();
  const api = await apiClient();
  const object = await apiJson<{ id: string }>(api, "post", "objects", {
    label: `Objekt Offline ${id}`,
    street: "Probeweg 7",
    city: "Musterstadt",
  });
  page.on("dialog", (d) => d.accept());

  await login(page);
  await page.goto("/vor-ort");
  // Service Worker aktiv und Objektliste im Offline-Puffer
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(
    page.getByRole("button", { name: new RegExp(`Objekt Offline ${id}`) }),
  ).toBeVisible();
  // Einmal neu laden, damit der Service Worker die Seite kontrolliert
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // --- offline ---
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await page.getByLabel("Objekt suchen").fill(id);
  await page.getByRole("button", { name: new RegExp(`Objekt Offline ${id}`) }).click();
  await page.getByLabel("Anlass").fill(`Erstbegehung ${id}`);
  await page.getByLabel(/Teilnehmende/).fill("Max Muster, Eigentümer");
  await page.getByLabel("Witterung").fill("bewölkt, 12 °C");
  await page.getByRole("button", { name: "Begehung starten" }).click();
  await expect(page.getByRole("heading", { name: `Erstbegehung ${id}` })).toBeVisible();

  await page.getByRole("button", { name: "+ Position" }).click();
  const editor = page.getByRole("form", { name: "Position" });
  await editor.getByLabel("Kategorie").selectOption("fenster");
  await editor.getByLabel("Bezeichnung").fill("Fenster EG");
  await editor.getByLabel("Lage / Raum").fill("Wohnzimmer");
  await editor.getByLabel("mittel").check();
  await editor.getByRole("button", { name: "+ Merkmal" }).click();
  await editor.getByLabel("Merkmal", { exact: true }).fill("Material");
  await editor.getByLabel("Wert").fill("Holz");
  await editor.getByRole("button", { name: "Position speichern" }).click();

  const item = page.getByTestId("inspection-item").filter({ hasText: "Fenster EG" });
  await expect(item).toContainText("Wohnzimmer");
  await item.getByLabel("Foto aufnehmen: Fenster EG").setInputFiles({
    name: "fenster.png",
    mimeType: "image/png",
    buffer: await pngBuffer(2400, 1800),
  });
  await expect(item.getByTestId("media-foto")).toContainText("wartet auf Übertragung");

  // Begehung, Position und Foto warten in der Warteschlange
  await expect(page.getByTestId("pending-count")).toHaveAttribute("data-pending", "3");
  await expect(
    page.getByText("Der Abschluss ist erst nach der Synchronisation möglich"),
  ).toBeVisible();

  // Nichts ist beim Server angekommen
  const before = await apiJson<{ items: unknown[] }>(
    api,
    "get",
    `inspections?objectId=${object.id}`,
  );
  expect(before.items).toHaveLength(0);

  // --- wieder online ---
  await context.setOffline(false);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  const syncButton = page.getByRole("button", { name: "Jetzt synchronisieren" }).first();
  if (await syncButton.isEnabled()) await syncButton.click();
  await expect(page.getByTestId("pending-count")).toHaveAttribute("data-pending", "0", {
    timeout: 20_000,
  });
  await expect(item.getByTestId("media-foto")).toContainText("übertragen");

  const list = await apiJson<{ items: { id: string }[] }>(
    api,
    "get",
    `inspections?objectId=${object.id}`,
  );
  expect(list.items).toHaveLength(1);
  const inspectionId = list.items[0]?.id as string;
  const synced = await apiJson<InspectionDetail>(api, "get", `inspections/${inspectionId}`);
  expect(synced.participants).toEqual([{ name: "Max Muster", role: "Eigentümer" }]);
  expect(synced.items).toHaveLength(1);
  expect(synced.items[0]).toMatchObject({
    category: "fenster",
    label: "Fenster EG",
    condition: "mittel",
    attributes: { Material: "Holz" },
  });
  expect(synced.media).toHaveLength(1);
  expect(synced.media[0]).toMatchObject({
    kind: "foto",
    mimeType: "image/jpeg",
    itemId: synced.items[0]?.id,
  });

  // Komprimiertes JPEG: längste Kante 1600 px
  const photo = await page.request.get(`/dokumente/${synced.media[0]?.documentId}`);
  expect(photo.headers()["content-type"]).toBe("image/jpeg");
  const size = await page.evaluate(
    async (b64) => {
      const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
      const bmp = await createImageBitmap(blob);
      return [bmp.width, bmp.height];
    },
    (await photo.body()).toString("base64"),
  );
  expect(size).toEqual([1600, 1200]);

  // --- Abschluss ---
  await page.getByRole("button", { name: "Begehung abschließen" }).click();
  const protocolLink = page.getByTestId("protocol-link");
  await expect(protocolLink).toBeVisible();

  const done = await apiJson<InspectionDetail>(api, "get", `inspections/${inspectionId}`);
  expect(done.status).toBe("abgeschlossen");
  expect(done.protocolDocumentId).toBeTruthy();
  const protocol = await page.request.get(`/dokumente/${done.protocolDocumentId}`);
  expect(protocol.status()).toBe(200);
  expect(await protocol.text()).toContain("Begehungsprotokoll");
});
