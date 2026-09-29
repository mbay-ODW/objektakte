import { api, must } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const client = api();
  const [digest, inbox, cases, receivables] = await Promise.all([
    client.GET("/api/v1/deadlines/digest", { params: { query: { days: 14 } } }),
    client.GET("/api/v1/communications/inbox", { params: { query: { includeAutomatic: true } } }),
    client.GET("/api/v1/cases", { params: { query: { limit: 500, offset: 0 } } }),
    client.GET("/api/v1/receivables", { params: { query: {} } }),
  ]);
  const open = must(receivables);
  const overdue = open.items.filter((r) => r.daysOverdue > 0);
  return {
    digest: must(digest),
    inbox: must(inbox),
    cases: must(cases).items,
    receivables: {
      totalOpenCents: open.totalOpenCents,
      count: open.items.length,
      overdueCount: overdue.length,
      overdueCents: overdue.reduce((s, r) => s + r.openCents, 0),
    },
  };
};
