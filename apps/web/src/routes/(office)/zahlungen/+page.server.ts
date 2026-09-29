import { fail } from "@sveltejs/kit";
import { api, apiFetch, decodeText, failed, must, rawResult } from "$lib/server/api";
import { text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

const STATUSES = ["offen", "zugeordnet", "teilweise", "ignoriert"] as const;
type Status = (typeof STATUSES)[number];

export const load: PageServerLoad = async ({ url }) => {
  const s = url.searchParams.get("status");
  const status = STATUSES.includes(s as Status) ? (s as Status) : undefined;
  const client = api();
  const [tx, receivables] = await Promise.all([
    client.GET("/api/v1/bank/transactions", { params: { query: { status } } }),
    client.GET("/api/v1/receivables", { params: { query: {} } }),
  ]);
  return {
    transactions: must(tx).items,
    receivables: must(receivables).items,
    filter: { status: status ?? "" },
  };
};

function txId(fd: FormData) {
  const id = text(fd, "transactionId");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export const actions: Actions = {
  import: async ({ request }) => {
    const fd = await request.formData();
    const file = fd.get("file");
    const account = text(fd, "account") ?? "Geschäftskonto";
    if (!(file instanceof File) || file.size === 0)
      return fail(400, { error: "CSV-Datei wählen." });
    if (file.size > 10 * 1024 * 1024) return fail(400, { error: "Datei größer als 10 MB." });
    const csv = decodeText(await file.arrayBuffer());
    const res = await apiFetch(
      `bank/transactions/import-csv?account=${encodeURIComponent(account)}`,
      { method: "POST", headers: { "content-type": "text/csv; charset=utf-8" }, body: csv },
    );
    const result = await rawResult<{
      received: number;
      imported: number;
      duplicates: number;
      allocated: number;
      errors: { line: number; message: string }[];
    }>(res);
    return failed(result) ?? { imported: result.data };
  },
  accept: async ({ request }) => {
    const fd = await request.formData();
    const id = txId(fd);
    const billingDocumentId = text(fd, "billingDocumentId");
    const amount = Number(text(fd, "amountCents"));
    if (!id || !billingDocumentId || !(amount > 0))
      return fail(400, { error: "Ungültiger Vorschlag." });
    const res = await api().POST("/api/v1/bank/transactions/{id}/allocate", {
      params: { path: { id } },
      body: { allocations: [{ billingDocumentId, amountCents: amount }] },
    });
    return failed(res) ?? { done: "Zahlung zugeordnet." };
  },
  allocate: async ({ request }) => {
    const fd = await request.formData();
    const id = txId(fd);
    if (!id) return fail(400, { error: "Umsatz fehlt." });
    const docs = fd.getAll("allocDoc").map(String);
    const amounts = fd.getAll("allocAmount").map(String);
    const allocations: { billingDocumentId: string; amountCents: number }[] = [];
    for (const [i, doc] of docs.entries()) {
      const raw = (amounts[i] ?? "").trim();
      if (!doc || !raw) continue;
      const n = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
      if (!Number.isFinite(n) || n <= 0) return fail(400, { error: `Betrag „${raw}“ ungültig.` });
      allocations.push({ billingDocumentId: doc, amountCents: Math.round(n * 100) });
    }
    const res = await api().POST("/api/v1/bank/transactions/{id}/allocate", {
      params: { path: { id } },
      body: { allocations },
    });
    return (
      failed(res) ?? { done: allocations.length ? "Zuordnung gespeichert." : "Zuordnung gelöst." }
    );
  },
  ignore: async ({ request }) => {
    const id = txId(await request.formData());
    if (!id) return fail(400, { error: "Umsatz fehlt." });
    const res = await api().POST("/api/v1/bank/transactions/{id}/ignore", {
      params: { path: { id } },
    });
    return failed(res) ?? { done: "Umsatz ignoriert." };
  },
  rematch: async () => {
    const res = await api().POST("/api/v1/bank/rematch");
    if (!res.data) return failed(res);
    return { done: `${res.data.checked} Umsätze geprüft, ${res.data.allocated} zugeordnet.` };
  },
};
