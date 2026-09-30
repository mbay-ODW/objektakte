import { error } from "@sveltejs/kit";
import { passThroughFile } from "$lib/server/download";
import type { RequestHandler } from "./$types";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET: RequestHandler = ({ url }) => {
  const from = url.searchParams.get("von") ?? "";
  const to = url.searchParams.get("bis") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) error(400, "Zeitraum angeben");
  return passThroughFile(`exports/datev?from=${from}&to=${to}`, { attachment: true });
};
