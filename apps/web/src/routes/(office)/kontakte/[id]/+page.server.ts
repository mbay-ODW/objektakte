import { api, must } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const client = api();
  const [contact, cases, timeline] = await Promise.all([
    client.GET("/api/v1/contacts/{id}", { params: { path: { id: params.id } } }),
    client.GET("/api/v1/cases", {
      params: { query: { customerId: params.id, limit: 200, offset: 0 } },
    }),
    client.GET("/api/v1/timeline", { params: { query: { contactId: params.id, limit: 50 } } }),
  ]);
  return {
    contact: must(contact),
    cases: must(cases).items,
    timeline: must(timeline).items,
  };
};
