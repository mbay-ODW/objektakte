import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Alle Tests teilen sich eine Test-Datenbank und laufen deshalb nacheinander.
    fileParallelism: false,
    env: {
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://objektakte:objektakte@localhost:5432/objektakte_test",
    },
  },
});
