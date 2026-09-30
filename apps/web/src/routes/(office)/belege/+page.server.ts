import { BILLING_STATUSES, BILLING_TYPES, type BillingStatus, type BillingType } from "$lib/labels";
import { api, must } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const p = url.searchParams;
  const type = BILLING_TYPES.includes(p.get("art") as BillingType)
    ? (p.get("art") as BillingType)
    : undefined;
  const status = BILLING_STATUSES.includes(p.get("status") as BillingStatus)
    ? (p.get("status") as BillingStatus)
    : undefined;
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
  const contactId = uuid(p.get("kontakt"));
  const caseId = uuid(p.get("vorgang"));
  const client = api();
  const [docs, contacts, cases] = await Promise.all([
    client.GET("/api/v1/billing-documents", {
      params: { query: { type, status, contactId, caseId, limit: 500 } },
    }),
    client.GET("/api/v1/contacts", { params: { query: { limit: 500, offset: 0 } } }),
    client.GET("/api/v1/cases", { params: { query: { limit: 500, offset: 0 } } }),
  ]);
  return {
    docs: must(docs).items,
    contacts: must(contacts).items.map((c) => ({ id: c.id, label: c.displayName, hint: c.city })),
    cases: must(cases).items.map((c) => ({
      id: c.id,
      label: `${c.number} – ${c.title}`,
      hint: c.customerName,
    })),
    filter: {
      type: type ?? "",
      status: status ?? "",
      contactId: contactId ?? "",
      caseId: caseId ?? "",
    },
  };
};
