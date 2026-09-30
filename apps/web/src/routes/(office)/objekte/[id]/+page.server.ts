import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  const client = api();
  const [object, inspections, contacts] = await Promise.all([
    client.GET("/api/v1/objects/{id}", { params: { path: { id: params.id } } }),
    client.GET("/api/v1/inspections", { params: { query: { objectId: params.id } } }),
    client.GET("/api/v1/contacts", { params: { query: { limit: 500, offset: 0 } } }),
  ]);
  return {
    object: must(object),
    inspections: must(inspections).items,
    contacts: contacts.data?.items ?? [],
  };
};

type Role =
  | "eigentuemer"
  | "verwaltung"
  | "nutzer"
  | "ansprechpartner"
  | "handwerker"
  | "planer"
  | "sonstige";

async function currentRoles(id: string) {
  const res = await api().GET("/api/v1/objects/{id}", { params: { path: { id } } });
  return must(res).roles.map((r) => ({ contactId: r.contactId, role: r.role as Role }));
}

async function saveRoles(id: string, roles: { contactId: string; role: Role }[]) {
  const res = await api().PUT("/api/v1/objects/{id}/roles", {
    params: { path: { id } },
    body: { roles },
  });
  return failed(res) ?? { saved: true };
}

export const actions: Actions = {
  addRole: async ({ request, params }) => {
    const fd = await request.formData();
    const contactId = text(fd, "contactId");
    const role = text(fd, "role") as Role | null;
    if (!contactId || !role) return fail(400, { error: "Kontakt und Rolle wählen." });
    return saveRoles(params.id, [...(await currentRoles(params.id)), { contactId, role }]);
  },
  removeRole: async ({ request, params }) => {
    const index = int(await request.formData(), "index");
    const roles = await currentRoles(params.id);
    return saveRoles(
      params.id,
      roles.filter((_, i) => i !== index),
    );
  },
};
