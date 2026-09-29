import { redirect } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { text, values } from "$lib/server/forms";
import { parseCase } from "$lib/server/parse";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const client = api();
  const [measures, contacts, objects] = await Promise.all([
    client.GET("/api/v1/measure-types"),
    client.GET("/api/v1/contacts", { params: { query: { limit: 500, offset: 0 } } }),
    client.GET("/api/v1/objects", { params: { query: { limit: 500, offset: 0 } } }),
  ]);
  return {
    measureTypes: must(measures).items,
    contacts: must(contacts).items,
    objects: must(objects).items,
    customerId: url.searchParams.get("customerId") ?? "",
    objectId: url.searchParams.get("objectId") ?? "",
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const res = await api().POST("/api/v1/cases", {
      body: { ...parseCase(fd), number: text(fd, "number") ?? undefined },
    });
    const err = failed(res, values(fd));
    if (err || !res.data) return err;
    redirect(303, `/vorgaenge/${res.data.id}`);
  },
};
