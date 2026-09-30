import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Formular-Posts werden per Origin-Prüfung gegen CSRF geschützt (Standard von SvelteKit).
    csrf: { trustedOrigins: [] },
    serviceWorker: { register: true },
    typescript: {
      // E2E-Tests und Playwright-Konfiguration mitprüfen (svelte-check).
      config: (config) => {
        config.include.push("../e2e/**/*.ts", "../playwright.config.ts");
      },
    },
  },
};

export default config;
