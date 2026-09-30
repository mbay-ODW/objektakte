import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

const STATUSES = ["offen", "erledigt", "verworfen"] as const;
type Status = (typeof STATUSES)[number];

export const load: PageServerLoad = async ({ url }) => {
  const statusParam = url.searchParams.get("status") ?? "offen";
  const status = STATUSES.includes(statusParam as Status) ? (statusParam as Status) : undefined;
  const dueBefore = url.searchParams.get("bis") || undefined;
  const days = Math.min(365, Math.max(0, Number(url.searchParams.get("tage") ?? 14) || 14));
  const client = api();
  const [list, digest] = await Promise.all([
    client.GET("/api/v1/deadlines", { params: { query: { status, dueBefore } } }),
    client.GET("/api/v1/deadlines/digest", { params: { query: { days } } }),
  ]);
  return {
    deadlines: must(list).items,
    digest: must(digest),
    filter: { status: status ?? "alle", dueBefore: dueBefore ?? "", days },
  };
};

export const actions: Actions = {
  status: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "deadlineId");
    const status = text(fd, "status") as Status | null;
    if (!id || !status || !STATUSES.includes(status)) return fail(400, { error: "Ungültig." });
    const res = await api().PATCH("/api/v1/deadlines/{id}", {
      params: { path: { id } },
      body: { status },
    });
    return failed(res) ?? { saved: true };
  },
  create: async ({ request }) => {
    const fd = await request.formData();
    const title = text(fd, "title");
    const dueDate = text(fd, "dueDate");
    if (!title || !dueDate) return fail(400, { error: "Titel und Fälligkeit angeben." });
    const res = await api().POST("/api/v1/deadlines", {
      body: { title, dueDate, remindFrom: text(fd, "remindFrom"), note: text(fd, "note") },
    });
    return failed(res) ?? { saved: true };
  },
};
