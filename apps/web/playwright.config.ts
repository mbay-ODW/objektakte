import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./e2e/env";

/**
 * End-to-End-Tests gegen die gebaute Web-App und die API aus diesem Repository.
 * Die Datenbank E2E.databaseUrl wird vor jedem Lauf vollständig zurückgesetzt.
 * Lokal lässt sich ein vorhandenes Chromium über PLAYWRIGHT_CHROMIUM_EXECUTABLE angeben.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E.webUrl,
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "tsx e2e/reset-db.ts && cd ../api && tsx src/index.ts",
      url: `${E2E.apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      env: {
        DATABASE_URL: E2E.databaseUrl,
        API_TOKEN: E2E.apiToken,
        PORT: String(E2E.apiPort),
        STORAGE_BACKEND: "local",
        STORAGE_DIR: E2E.storageDir,
        WEBHOOK_INTERVAL_MS: "60000",
        WORKER_INTERVAL_MS: "60000",
      },
    },
    {
      command: "vite build && node build",
      url: `${E2E.webUrl}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: String(E2E.webPort),
        HOST: "127.0.0.1",
        ORIGIN: E2E.webUrl,
        API_URL: E2E.apiUrl,
        API_TOKEN: E2E.apiToken,
        WEB_PASSWORD: E2E.password,
        WEB_SESSION_SECRET: "e2e-sitzungsschluessel-mindestens-32-zeichen",
        BODY_SIZE_LIMIT: "80M",
      },
    },
  ],
});
