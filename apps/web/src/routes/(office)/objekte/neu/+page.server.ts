import { redirect } from "@sveltejs/kit";
import { api, failed } from "$lib/server/api";
import { text, values } from "$lib/server/forms";
import { parseObject } from "$lib/server/parse";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const res = await api().GET("/api/v1/contacts", { params: { query: { limit: 500, offset: 0 } } });
  return { contacts: res.data?.items ?? [], ownerId: url.searchParams.get("ownerId") ?? "" };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const ownerId = text(fd, "ownerId");
    const res = await api().POST("/api/v1/objects", {
      body: {
        ...parseObject(fd),
        roles: ownerId ? [{ contactId: ownerId, role: "eigentuemer" }] : [],
      },
    });
    const err = failed(res, values(fd));
    if (err || !res.data) return err;
    redirect(303, `/objekte/${res.data.id}`);
  },
};
