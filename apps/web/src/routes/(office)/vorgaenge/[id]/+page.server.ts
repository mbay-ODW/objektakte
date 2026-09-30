import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { text, values } from "$lib/server/forms";
import { parseCase, parseFunding } from "$lib/server/parse";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const client = api();
  const id = params.id;
  const [kase, measures, programs, funding, deadlines, timeline, inspections, objects] =
    await Promise.all([
      client.GET("/api/v1/cases/{id}", { params: { path: { id } } }),
      client.GET("/api/v1/measure-types"),
      client.GET("/api/v1/funding-programs"),
      client.GET("/api/v1/funding-cases", { params: { query: { caseId: id } } }),
      client.GET("/api/v1/deadlines", { params: { query: { caseId: id } } }),
      client.GET("/api/v1/timeline", { params: { query: { caseId: id, limit: 200 } } }),
      client.GET("/api/v1/inspections", { params: { query: { caseId: id } } }),
      client.GET("/api/v1/objects", { params: { query: { limit: 500, offset: 0 } } }),
    ]);
  const billing = await client.GET("/api/v1/billing-documents", {
    params: { query: { caseId: id, limit: 200 } },
  });
  return {
    kase: must(kase),
    measureTypes: must(measures).items,
    programs: must(programs).items,
    fundingCases: must(funding).items,
    deadlines: must(deadlines).items,
    timeline: must(timeline).items,
    inspections: must(inspections).items,
    objects: must(objects).items,
    billing: must(billing).items,
  };
};

export const actions: Actions = {
  statusAuto: async ({ params }) => {
    const res = await api().POST("/api/v1/cases/{id}/status/auto", {
      params: { path: { id: params.id } },
    });
    return failed(res) ?? { saved: "case" };
  },
  update: async ({ request, params }) => {
    const fd = await request.formData();
    const { customerId: _customerId, ...patch } = parseCase(fd);
    const res = await api().PATCH("/api/v1/cases/{id}", {
      params: { path: { id: params.id } },
      body: { ...patch, title: patch.title || undefined },
    });
    return failed(res, values(fd)) ?? { saved: "case" };
  },
  createFunding: async ({ request, params }) => {
    const fd = await request.formData();
    const body = parseFunding(fd);
    if (!body.programCode) return fail(400, { error: "Förderprogramm wählen." });
    const res = await api().POST("/api/v1/cases/{id}/funding-cases", {
      params: { path: { id: params.id } },
      body,
    });
    return failed(res, values(fd)) ?? { saved: "funding" };
  },
  updateFunding: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "fundingId");
    if (!id) return fail(400, { error: "Förderfall fehlt." });
    const res = await api().PATCH("/api/v1/funding-cases/{id}", {
      params: { path: { id } },
      body: parseFunding(fd),
    });
    return failed(res, values(fd)) ?? { saved: "funding" };
  },
  deadlineStatus: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "deadlineId");
    const status = text(fd, "status");
    if (!id || (status !== "offen" && status !== "erledigt" && status !== "verworfen")) {
      return fail(400, { error: "Ungültige Angaben." });
    }
    const res = await api().PATCH("/api/v1/deadlines/{id}", {
      params: { path: { id } },
      body: { status },
    });
    return failed(res) ?? { saved: "deadline" };
  },
  createDeadline: async ({ request, params }) => {
    const fd = await request.formData();
    const title = text(fd, "title");
    const dueDate = text(fd, "dueDate");
    if (!title || !dueDate) return fail(400, { error: "Titel und Fälligkeit angeben." });
    const res = await api().POST("/api/v1/deadlines", {
      body: {
        caseId: params.id,
        title,
        dueDate,
        remindFrom: text(fd, "remindFrom"),
        note: text(fd, "note"),
      },
    });
    return failed(res, values(fd)) ?? { saved: "deadline" };
  },
};
