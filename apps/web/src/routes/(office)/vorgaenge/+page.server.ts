import { fail } from "@sveltejs/kit";
import { CASE_STATUSES, type CaseStatus } from "$lib/labels";
import { api, failed, must } from "$lib/server/api";
import { text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const statusParam = url.searchParams.get("status");
  const status = CASE_STATUSES.includes(statusParam as CaseStatus)
    ? (statusParam as CaseStatus)
    : undefined;
  const measureCode = url.searchParams.get("leistungsart") || undefined;
  const view = url.searchParams.get("ansicht") === "board" ? "board" : "liste";
  const client = api();
  const [cases, measures] = await Promise.all([
    client.GET("/api/v1/cases", {
      params: {
        query: {
          status: view === "board" ? undefined : status,
          measureCode,
          limit: 500,
          offset: 0,
        },
      },
    }),
    client.GET("/api/v1/measure-types"),
  ]);
  return {
    cases: must(cases).items,
    measureTypes: must(measures).items,
    filter: { status: status ?? "", measureCode: measureCode ?? "" },
    view,
  };
};

export const actions: Actions = {
  status: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "id");
    const status = text(fd, "status") as CaseStatus | null;
    if (!id || !status || !CASE_STATUSES.includes(status)) {
      return fail(400, { error: "Ungültiger Status." });
    }
    const res = await api().PATCH("/api/v1/cases/{id}", {
      params: { path: { id } },
      body: { status },
    });
    return failed(res) ?? { saved: true };
  },
};
