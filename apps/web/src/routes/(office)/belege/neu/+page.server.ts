import { fail, redirect } from "@sveltejs/kit";
import { api, failed } from "$lib/server/api";
import { parseBillingForm } from "$lib/server/billing";
import { values } from "$lib/server/forms";
import { billingEditorData } from "$lib/server/options";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const data = await billingEditorData();
  const caseId = url.searchParams.get("vorgang") ?? "";
  return {
    ...data,
    defaults: {
      type: url.searchParams.get("art") ?? "rechnung",
      caseId,
      contactId: url.searchParams.get("kontakt") ?? data.caseCustomers[caseId] ?? "",
    },
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const parsed = parseBillingForm(fd);
    if ("error" in parsed) return fail(400, { error: parsed.error, values: values(fd) });
    if (!parsed.type) return fail(400, { error: "Belegart wählen", values: values(fd) });
    const res = await api().POST("/api/v1/billing-documents", {
      body: { ...parsed.fields, type: parsed.type },
    });
    const err = failed(res, values(fd));
    if (err || !res.data) return err;
    redirect(303, `/belege/${res.data.id}`);
  },
};
