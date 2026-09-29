import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, text, values } from "$lib/server/forms";
import { parseContact } from "$lib/server/parse";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const client = api();
  const [inbox, cases, measures] = await Promise.all([
    client.GET("/api/v1/communications/inbox", { params: { query: { includeAutomatic: true } } }),
    client.GET("/api/v1/cases", { params: { query: { limit: 500, offset: 0 } } }),
    client.GET("/api/v1/measure-types"),
  ]);
  return { inbox: must(inbox), cases: must(cases).items, measureTypes: must(measures).items };
};

function messageId(fd: FormData) {
  const id = text(fd, "messageId");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return id;
}

export const actions: Actions = {
  assign: async ({ request }) => {
    const fd = await request.formData();
    const id = messageId(fd);
    const caseId = text(fd, "caseId");
    if (!id || !caseId) return fail(400, { error: "Vorgang wählen.", messageId: id });
    const res = await api().POST("/api/v1/communications/{id}/assign", {
      params: { path: { id } },
      body: { caseId, learnChannel: bool(fd, "learnChannel") },
    });
    return failed(res) ?? { done: "Zugeordnet." };
  },
  confirm: async ({ request }) => {
    const id = messageId(await request.formData());
    if (!id) return fail(400, { error: "Nachricht fehlt." });
    const res = await api().POST("/api/v1/communications/{id}/confirm", {
      params: { path: { id } },
    });
    return failed(res) ?? { done: "Zuordnung bestätigt." };
  },
  ignore: async ({ request }) => {
    const id = messageId(await request.formData());
    if (!id) return fail(400, { error: "Nachricht fehlt." });
    const res = await api().POST("/api/v1/communications/{id}/ignore", {
      params: { path: { id } },
    });
    return failed(res) ?? { done: "Ignoriert." };
  },
  lead: async ({ request }) => {
    const fd = await request.formData();
    const id = messageId(fd);
    const title = text(fd, "title");
    if (!id || !title) return fail(400, { error: "Titel der Anfrage angeben." });
    const useExisting = fd.get("contactMode") === "existing";
    const res = await api().POST("/api/v1/communications/{id}/lead", {
      params: { path: { id } },
      body: {
        contact: useExisting ? undefined : { ...parseContact(fd, "contact_"), channels: [] },
        case: {
          title,
          measureCode: text(fd, "measureCode"),
          notes: text(fd, "notes"),
          status: "anfrage",
        },
      },
    });
    return failed(res, values(fd)) ?? { done: "Anfrage angelegt.", caseId: res.data?.caseId };
  },
  rematch: async () => {
    const res = await api().POST("/api/v1/communications/rematch");
    if (!res.data) return failed(res);
    return { done: `${res.data.checked} geprüft, ${res.data.assigned} neu zugeordnet.` };
  },
};
