import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/measure-types");
  return { items: must(res).items };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const fd = await request.formData();
    const code = text(fd, "code");
    const name = text(fd, "name");
    if (!code || !name) return fail(400, { error: "Kürzel und Bezeichnung angeben." });
    const res = await api().PUT("/api/v1/measure-types/{code}", {
      params: { path: { code } },
      body: { name, description: text(fd, "description"), active: bool(fd, "active") },
    });
    return failed(res) ?? { saved: true };
  },
};
