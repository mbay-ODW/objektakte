import { fail } from "@sveltejs/kit";
import type { components } from "$lib/api/schema";
import { api, failed, must } from "$lib/server/api";
import { bool, int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

type Anchor = components["schemas"]["DeadlineRuleInput"]["anchor"];

export const load: PageServerLoad = async () => {
  const client = api();
  const [rules, programs] = await Promise.all([
    client.GET("/api/v1/deadline-rules"),
    client.GET("/api/v1/funding-programs"),
  ]);
  return { rules: must(rules).items, programs: must(programs).items };
};

function parseRule(fd: FormData) {
  const programCode = text(fd, "programCode");
  const title = text(fd, "title");
  const anchor = text(fd, "anchor") as Anchor | null;
  if (!programCode || !title || !anchor) return null;
  return {
    programCode,
    title,
    anchor,
    guideline: text(fd, "guideline"),
    offsetMonths: int(fd, "offsetMonths") ?? 0,
    offsetDays: int(fd, "offsetDays") ?? 0,
    leadDays: int(fd, "leadDays") ?? 30,
    doneWhen: text(fd, "doneWhen") as Anchor | null,
    description: text(fd, "description"),
    sourceNote: text(fd, "sourceNote"),
    active: bool(fd, "active"),
  };
}

export const actions: Actions = {
  create: async ({ request }) => {
    const rule = parseRule(await request.formData());
    if (!rule) return fail(400, { error: "Programm, Titel und Anker angeben." });
    const res = await api().POST("/api/v1/deadline-rules", { body: rule });
    return failed(res) ?? { saved: true };
  },
  update: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "id");
    const rule = parseRule(fd);
    if (!id || !rule) return fail(400, { error: "Programm, Titel und Anker angeben." });
    const res = await api().PATCH("/api/v1/deadline-rules/{id}", {
      params: { path: { id } },
      body: rule,
    });
    return failed(res) ?? { saved: true };
  },
  toggle: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "id");
    if (!id) return fail(400, { error: "Regel fehlt." });
    const res = await api().PATCH("/api/v1/deadline-rules/{id}", {
      params: { path: { id } },
      body: { active: fd.get("active") === "true" },
    });
    return failed(res) ?? { saved: true };
  },
};
