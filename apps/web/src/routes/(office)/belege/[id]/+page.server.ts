import { fail, redirect } from "@sveltejs/kit";
import { DRAFT_TYPES, type DraftType, INVOICE_TYPES } from "$lib/labels";
import { api, failed, must } from "$lib/server/api";
import { parseBillingForm } from "$lib/server/billing";
import { cents, int, text, values } from "$lib/server/forms";
import { billingEditorData } from "$lib/server/options";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const client = api();
  const doc = must(
    await client.GET("/api/v1/billing-documents/{id}", { params: { path: { id: params.id } } }),
  );
  if (doc.status === "entwurf") {
    const [check, editor] = await Promise.all([
      client.GET("/api/v1/billing-documents/{id}/check", { params: { path: { id: doc.id } } }),
      billingEditorData(),
    ]);
    return {
      doc,
      check: check.data ?? null,
      checkError: check.data ? null : "Vorprüfung nicht möglich",
      editor,
      receivable: null,
      related: [],
    };
  }
  const [receivables, related] = await Promise.all([
    INVOICE_TYPES.includes(doc.type)
      ? client.GET("/api/v1/receivables", { params: { query: {} } })
      : Promise.resolve(null),
    doc.caseId
      ? client.GET("/api/v1/billing-documents", {
          params: { query: { caseId: doc.caseId, limit: 100 } },
        })
      : client.GET("/api/v1/billing-documents", {
          params: { query: { contactId: doc.contactId, limit: 100 } },
        }),
  ]);
  return {
    doc,
    check: null,
    checkError: null,
    editor: null,
    receivable: receivables?.data?.items.find((r) => r.billingDocumentId === doc.id) ?? null,
    related: (related.data?.items ?? []).filter(
      (d) =>
        d.id !== doc.id && (d.precedingDocumentId === doc.id || doc.precedingDocumentId === d.id),
    ),
  };
};

export const actions: Actions = {
  save: async ({ request, params }) => {
    const fd = await request.formData();
    const parsed = parseBillingForm(fd);
    if ("error" in parsed) return fail(400, { error: parsed.error, values: values(fd) });
    const res = await api().PATCH("/api/v1/billing-documents/{id}", {
      params: { path: { id: params.id } },
      body: parsed.fields,
    });
    return failed(res, values(fd)) ?? { done: "Entwurf gespeichert." };
  },
  delete: async ({ params }) => {
    const res = await api().DELETE("/api/v1/billing-documents/{id}", {
      params: { path: { id: params.id } },
    });
    const err = failed(res);
    if (err) return err;
    redirect(303, "/belege");
  },
  finalize: async ({ params }) => {
    const res = await api().POST("/api/v1/billing-documents/{id}/finalize", {
      params: { path: { id: params.id } },
    });
    return failed(res) ?? { done: `Festgeschrieben als ${res.data?.number ?? ""}.` };
  },
  sent: async ({ request, params }) => {
    const via = text(await request.formData(), "via") ?? "E-Mail";
    const res = await api().POST("/api/v1/billing-documents/{id}/sent", {
      params: { path: { id: params.id } },
      body: { via },
    });
    return failed(res) ?? { done: "Als versendet markiert." };
  },
  convert: async ({ request, params }) => {
    const type = text(await request.formData(), "type") as DraftType | null;
    if (!type || !DRAFT_TYPES.includes(type)) return fail(400, { error: "Belegart wählen." });
    const res = await api().POST("/api/v1/billing-documents/{id}/convert", {
      params: { path: { id: params.id } },
      body: { type },
    });
    const err = failed(res);
    if (err || !res.data) return err;
    redirect(303, `/belege/${res.data.id}`);
  },
  cancel: async ({ params }) => {
    const res = await api().POST("/api/v1/billing-documents/{id}/cancel", {
      params: { path: { id: params.id } },
    });
    const err = failed(res);
    if (err || !res.data) return err;
    redirect(303, `/belege/${res.data.storno.id}`);
  },
  reminder: async ({ request, params }) => {
    const fd = await request.formData();
    const res = await api().POST("/api/v1/billing-documents/{id}/reminder", {
      params: { path: { id: params.id } },
      body: {
        level: int(fd, "level") ?? 1,
        feeCents: cents(fd, "fee") ?? 0,
        dueDays: int(fd, "dueDays") ?? 10,
      },
    });
    const err = failed(res);
    if (err || !res.data) return err;
    redirect(303, `/belege/${res.data.id}`);
  },
};
