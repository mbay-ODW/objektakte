import { error } from "@sveltejs/kit";
import { passThroughFile, UUID } from "$lib/server/download";
import type { RequestHandler } from "./$types";

/** Datei eines Dokuments über die API laden, ohne das API-Token preiszugeben. */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!UUID.test(params.id)) error(400, "Ungültige Dokument-ID");
  const res = await passThroughFile(`documents/${params.id}/file`, {
    attachment: url.searchParams.has("download"),
  });
  res.headers.set("cache-control", "private, max-age=3600");
  return res;
};
