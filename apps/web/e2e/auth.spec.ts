import { expect, test } from "@playwright/test";
import { E2E } from "./env";
import { login } from "./helpers";

test("ohne Anmeldung wird auf das Login umgeleitet", async ({ page }) => {
  await page.goto("/kontakte");
  await expect(page).toHaveURL(/\/login\?next=%2Fkontakte/);
});

test("falsches Passwort wird abgelehnt", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passwort").fill("falsch");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByRole("alert")).toHaveText("Passwort ist falsch.");
});

test("Anmelden, Sitzungscookie und Abmelden", async ({ page, context }) => {
  await login(page);
  const cookie = (await context.cookies()).find((c) => c.name === "oa_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("API-Proxy verlangt Sitzung, Same-Origin und Client-Header", async ({ page, request }) => {
  const anonymous = await request.get(`${E2E.webUrl}/api-proxy/contacts`, {
    headers: { "x-objektakte-client": "1" },
  });
  expect(anonymous.status()).toBe(401);

  await login(page);
  const status = (headers: Record<string, string>) =>
    page.evaluate(
      async (h) => (await fetch("/api-proxy/contacts", { headers: h })).status,
      headers,
    );
  expect(await status({})).toBe(403);
  expect(await status({ "x-objektakte-client": "1" })).toBe(200);
  // Das API-Token erscheint nirgends im Browser.
  expect(await page.content()).not.toContain(E2E.apiToken);
});
