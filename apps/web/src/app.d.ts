// Siehe https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      /** true, wenn eine gültige Sitzung besteht. */
      authenticated: boolean;
    }
    interface Error {
      message: string;
    }
  }
}

export {};
