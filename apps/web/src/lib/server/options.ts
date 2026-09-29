import type { PickerOption } from "$lib/components/SearchPicker.svelte";
import { api, must } from "./api";

/** Auswahllisten für den Beleg-Editor. */
export async function billingEditorData() {
  const client = api();
  const [contacts, cases, articles, company] = await Promise.all([
    client.GET("/api/v1/contacts", { params: { query: { limit: 500, offset: 0 } } }),
    client.GET("/api/v1/cases", { params: { query: { limit: 500, offset: 0 } } }),
    client.GET("/api/v1/articles"),
    client.GET("/api/v1/settings/company"),
  ]);
  const contactOptions: PickerOption[] = must(contacts).items.map((c) => ({
    id: c.id,
    label: c.displayName,
    hint: [c.customerNumber, c.city, c.leitwegId ? `Leitweg-ID ${c.leitwegId}` : null]
      .filter(Boolean)
      .join(" · "),
  }));
  const caseItems = must(cases).items;
  const caseOptions: PickerOption[] = caseItems.map((c) => ({
    id: c.id,
    label: `${c.number} – ${c.title}`,
    hint: c.customerName,
  }));
  const companyData = must(company);
  return {
    contacts: contactOptions,
    cases: caseOptions,
    caseCustomers: Object.fromEntries(caseItems.map((c) => [c.id, c.customerId])),
    articles: must(articles).items,
    smallBusiness: companyData.smallBusiness,
    companyMissing: !companyData.name,
  };
}
