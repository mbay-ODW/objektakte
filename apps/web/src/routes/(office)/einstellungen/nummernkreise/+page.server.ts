import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/number-sequences");
  return { items: must(res).items };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const fd = await request.formData();
    const key = text(fd, "key");
    const nextValue = int(fd, "nextValue");
    if (!key || !nextValue) return fail(400, { error: "Schlüssel und nächsten Wert angeben." });
    const res = await api().PUT("/api/v1/number-sequences/{key}", {
      params: { path: { key } },
      body: { nextValue, padding: int(fd, "padding") ?? 0 },
    });
    return failed(res) ?? { saved: true };
  },
};
