import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { lines, num } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/settings/communication");
  return { settings: must(res) };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const threshold = num(fd, "autoAssignThreshold");
    if (threshold === null || threshold < 0 || threshold > 1) {
      return fail(400, { error: "Schwellwert zwischen 0 und 1 angeben." });
    }
    const res = await api().PUT("/api/v1/settings/communication", {
      body: {
        ownAddresses: lines(fd, "ownAddresses"),
        ignoredAddresses: lines(fd, "ignoredAddresses"),
        autoAssignThreshold: threshold,
      },
    });
    return failed(res) ?? { saved: true };
  },
};
