import { fail, redirect } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, cents, int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const overdueOnly = url.searchParams.get("ueberfaellig") === "1";
  // overdueOnly nur senden, wenn gesetzt: die API wertet jeden übergebenen Wert als wahr.
  const res = await api().GET("/api/v1/receivables", {
    params: { query: overdueOnly ? { overdueOnly: true } : {} },
  });
  return { ...must(res), overdueOnly };
};

export const actions: Actions = {
  reminder: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "billingDocumentId");
    if (!id) return fail(400, { error: "Rechnung fehlt." });
    const res = await api().POST("/api/v1/billing-documents/{id}/reminder", {
      params: { path: { id } },
      body: {
        level: int(fd, "level") ?? 1,
        feeCents: cents(fd, "fee") ?? 0,
        dueDays: int(fd, "dueDays") ?? 10,
      },
    });
    const err = failed(res);
    if (err || !res.data) return err;
    if (bool(fd, "open")) redirect(303, `/belege/${res.data.id}`);
    return {
      done: `Zahlungserinnerung ${res.data.number ?? ""} erzeugt.`,
      reminderId: res.data.id,
    };
  },
};
