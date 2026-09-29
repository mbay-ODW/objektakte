import { error } from "@sveltejs/kit";
import { passThroughFile } from "$lib/server/download";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  const month = url.searchParams.get("monat") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) error(400, "Monat angeben (JJJJ-MM)");
  return passThroughFile(`exports/monthly?month=${month}`, { attachment: true });
};
