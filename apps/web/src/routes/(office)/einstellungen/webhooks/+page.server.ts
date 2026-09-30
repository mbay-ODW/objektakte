import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, lines, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/webhooks");
  return { items: must(res).items };
};

export const actions: Actions = {
  create: async ({ request }) => {
    const fd = await request.formData();
    const url = text(fd, "url");
    if (!url) return fail(400, { error: "URL angeben." });
    const eventTypes = lines(fd, "eventTypes");
    const res = await api().POST("/api/v1/webhooks", {
      body: {
        url,
        eventTypes: eventTypes.length > 0 ? eventTypes : ["*"],
        replay: bool(fd, "replay"),
      },
    });
    const err = failed(res);
    if (err || !res.data) return err;
    // Das Geheimnis wird nur jetzt einmal angezeigt.
    return { created: { url: res.data.url, secret: res.data.secret } };
  },
  toggle: async ({ request }) => {
    const fd = await request.formData();
    const id = text(fd, "id");
    if (!id) return fail(400, { error: "Webhook fehlt." });
    const res = await api().PATCH("/api/v1/webhooks/{id}", {
      params: { path: { id } },
      body: { active: fd.get("active") === "true", resetFailures: true },
    });
    return failed(res) ?? { saved: true };
  },
  remove: async ({ request }) => {
    const id = text(await request.formData(), "id");
    if (!id) return fail(400, { error: "Webhook fehlt." });
    const res = await api().DELETE("/api/v1/webhooks/{id}", { params: { path: { id } } });
    return failed(res) ?? { saved: true };
  },
};
