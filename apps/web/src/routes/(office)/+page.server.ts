import { api, must } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const client = api();
  const [digest, inbox, cases] = await Promise.all([
    client.GET("/api/v1/deadlines/digest", { params: { query: { days: 14 } } }),
    client.GET("/api/v1/communications/inbox", { params: { query: { includeAutomatic: true } } }),
    client.GET("/api/v1/cases", { params: { query: { limit: 500, offset: 0 } } }),
  ]);
  return { digest: must(digest), inbox: must(inbox), cases: must(cases).items };
};
