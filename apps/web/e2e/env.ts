/** Gemeinsame Einstellungen der E2E-Tests (nur synthetische Testwerte). */
const apiPort = Number(process.env.E2E_API_PORT ?? 3100);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4300);

export const E2E = {
  apiPort,
  webPort,
  apiUrl: `http://127.0.0.1:${apiPort}`,
  webUrl: `http://localhost:${webPort}`,
  apiToken: "e2e-api-token-123456",
  password: "e2e-passwort",
  databaseUrl:
    process.env.E2E_DATABASE_URL ??
    "postgres://objektakte:objektakte@localhost:5432/objektakte_web",
  storageDir: process.env.E2E_STORAGE_DIR ?? "/tmp/objektakte-web-e2e-files",
};
