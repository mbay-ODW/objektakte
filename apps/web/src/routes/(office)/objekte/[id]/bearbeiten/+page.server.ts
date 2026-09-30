import { redirect } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { values } from "$lib/server/forms";
import { parseObject } from "$lib/server/parse";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const res = await api().GET("/api/v1/objects/{id}", { params: { path: { id: params.id } } });
  return { object: must(res) };
};

export const actions: Actions = {
  default: async ({ request, params }) => {
    const fd = await request.formData();
    const res = await api().PATCH("/api/v1/objects/{id}", {
      params: { path: { id: params.id } },
      body: parseObject(fd),
    });
    const err = failed(res, values(fd));
    if (err) return err;
    redirect(303, `/objekte/${params.id}`);
  },
};
