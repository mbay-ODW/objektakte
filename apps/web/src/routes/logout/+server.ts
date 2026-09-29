import { redirect } from "@sveltejs/kit";
import { SESSION_COOKIE } from "$lib/server/session";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = ({ cookies, setHeaders }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  // Zwischengespeicherte Daten entfernen; die IndexedDB mit nicht übertragenen Begehungen bleibt.
  setHeaders({ "clear-site-data": '"cache"' });
  redirect(303, "/login");
};
