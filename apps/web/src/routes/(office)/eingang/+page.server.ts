import { fail } from "@sveltejs/kit";
import type { components } from "$lib/api/schema";
import { api, apiFetch, failed, must, rawResult } from "$lib/server/api";
import { text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

const STATUSES = ["offen", "geprueft", "bezahlt", "abgelehnt"] as const;
type Status = (typeof STATUSES)[number];

export const load: PageServerLoad = async ({ url }) => {
  const s = url.searchParams.get("status");
  const status = STATUSES.includes(s as Status) ? (s as Status) : undefined;
  const res = await api().GET("/api/v1/incoming-invoices", { params: { query: { status } } });
  return { items: must(res).items, filter: { status: status ?? "" } };
};

export const actions: Actions = {
  upload: async ({ request }) => {
    const fd = await request.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return fail(400, { error: "Datei wählen." });
    if (file.size > 25 * 1024 * 1024) return fail(400, { error: "Datei größer als 25 MB." });
    const res = await apiFetch(`incoming-invoices?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    const result = await rawResult<components["schemas"]["IncomingInvoice"]>(res);
    const err = failed(result);
    if (err || !result.data) return err;
    return {
      done:
        res.status === 200
          ? `Rechnung ${result.data.number} war bereits vorhanden.`
          : `Rechnung ${result.data.number} von ${result.data.sellerName ?? "unbekannt"} übernommen.`,
    };
  },
  status: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "id");
    const status = text(fd, "status") as Status | null;
    if (!id || !status || !STATUSES.includes(status)) return fail(400, { error: "Ungültig." });
    const res = await api().PATCH("/api/v1/incoming-invoices/{id}", {
      params: { path: { id } },
      body: { status },
    });
    return failed(res) ?? { done: "Status gesetzt." };
  },
};
