import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/funding-programs");
  return { items: must(res).items };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const fd = await request.formData();
    const code = text(fd, "code");
    const name = text(fd, "name");
    if (!code || !name) return fail(400, { error: "Code und Bezeichnung angeben." });
    if (!/^[a-z0-9_]+$/.test(code)) {
      return fail(400, { error: "Code: nur Kleinbuchstaben, Ziffern und _." });
    }
    const res = await api().PUT("/api/v1/funding-programs/{code}", {
      params: { path: { code } },
      body: {
        name,
        approvalPeriodMonths: int(fd, "approvalPeriodMonths"),
        active: bool(fd, "active"),
      },
    });
    return failed(res) ?? { saved: true };
  },
};
