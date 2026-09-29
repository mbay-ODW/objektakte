import { fail, redirect } from "@sveltejs/kit";
import { webEnv } from "$lib/server/env";
import {
  constantTimeEqual,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "$lib/server/session";
import type { Actions, PageServerLoad } from "./$types";

/** Nur relative Ziele innerhalb der Anwendung zulassen (kein Open Redirect). */
function safeNext(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.authenticated) redirect(303, safeNext(url.searchParams.get("next")));
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const env = webEnv();
    const fd = await request.formData();
    const password = fd.get("password");
    if (typeof password !== "string" || !constantTimeEqual(password, env.password)) {
      // Kleine Verzögerung bremst das Durchprobieren von Passwörtern.
      await new Promise((r) => setTimeout(r, 400));
      return fail(401, { error: "Passwort ist falsch." });
    }
    cookies.set(SESSION_COOKIE, createSessionToken(env.sessionSecret), {
      path: "/",
      httpOnly: true,
      secure: env.secureCookie,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_S,
    });
    redirect(303, safeNext(url.searchParams.get("next")));
  },
};
