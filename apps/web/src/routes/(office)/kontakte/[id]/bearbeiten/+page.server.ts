import { redirect } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { values } from "$lib/server/forms";
import { parseContact } from "$lib/server/parse";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const res = await api().GET("/api/v1/contacts/{id}", { params: { path: { id: params.id } } });
  return { contact: must(res) };
};

export const actions: Actions = {
  default: async ({ request, params }) => {
    const fd = await request.formData();
    const { displayName, ...rest } = parseContact(fd);
    const derived =
      displayName ??
      (rest.kind === "organisation"
        ? rest.organisationName
        : [rest.firstName, rest.lastName].filter(Boolean).join(" ")) ??
      undefined;
    const res = await api().PATCH("/api/v1/contacts/{id}", {
      params: { path: { id: params.id } },
      body: { ...rest, displayName: derived || undefined },
    });
    const err = failed(res, values(fd));
    if (err) return err;
    redirect(303, `/kontakte/${params.id}`);
  },
};
