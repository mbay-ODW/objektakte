import { redirect } from "@sveltejs/kit";
import { api, failed } from "$lib/server/api";
import { values } from "$lib/server/forms";
import { parseContact } from "$lib/server/parse";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const res = await api().POST("/api/v1/contacts", { body: parseContact(fd) });
    const err = failed(res, values(fd));
    if (err || !res.data) return err;
    redirect(303, `/kontakte/${res.data.id}`);
  },
};
