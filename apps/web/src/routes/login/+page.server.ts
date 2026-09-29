import { fail, redirect } from "@sveltejs/kit";
import { webEnv } from "$lib/server/env";
import { loginLimiter, waitMessage } from "$lib/server/rate-limit";
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
  default: async ({ request, cookies, url, getClientAddress }) => {
    const env = webEnv();
    const client = getClientAddress();
    const wait = loginLimiter.retryAfter(client);
    if (wait > 0) return fail(429, { error: waitMessage(wait) });

    const fd = await request.formData();
    const password = fd.get("password");
    if (typeof password !== "string" || !constantTimeEqual(password, env.password)) {
      loginLimiter.fail(client);
      // Kleine Verzögerung bremst das Durchprobieren von Passwörtern zusätzlich.
      await new Promise((r) => setTimeout(r, 400));
      return fail(401, { error: "Passwort ist falsch." });
    }
    loginLimiter.reset(client);
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
