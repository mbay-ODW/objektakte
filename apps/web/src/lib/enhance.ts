import type { SubmitFunction } from "@sveltejs/kit";

/** Für Bearbeiten-Formulare: nach dem Speichern Eingaben nicht auf Ausgangswerte zurücksetzen. */
export const keepValues: SubmitFunction =
  () =>
  async ({ update }) =>
    update({ reset: false });
