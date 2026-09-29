import { type Handle, json, redirect } from "@sveltejs/kit";
import { webEnv } from "$lib/server/env";
import { isDataPath, isPublicPath } from "$lib/server/paths";
import { SESSION_COOKIE, verifySessionToken } from "$lib/server/session";

export const handle: Handle = async ({ event, resolve }) => {
  const env = webEnv();
  event.locals.authenticated = verifySessionToken(
    env.sessionSecret,
    event.cookies.get(SESSION_COOKIE),
  );

  const path = event.url.pathname;
  if (!event.locals.authenticated && !isPublicPath(path)) {
    if (isDataPath(path) || event.request.method !== "GET") {
      return json({ error: "unauthorized", message: "Nicht angemeldet" }, { status: 401 });
    }
    const next = path === "/" ? "" : `?next=${encodeURIComponent(path + event.url.search)}`;
    redirect(303, `/login${next}`);
  }

  const response = await resolve(event);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "same-origin");
  response.headers.set("x-frame-options", "DENY");
  return response;
};
