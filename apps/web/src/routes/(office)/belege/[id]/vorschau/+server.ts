import { error } from "@sveltejs/kit";
import { passThroughFile, UUID } from "$lib/server/download";
import type { RequestHandler } from "./$types";

/** PDF-Vorschau eines Entwurfs (Vermerk „Entwurf“). */
export const GET: RequestHandler = async ({ params }) => {
  if (!UUID.test(params.id)) error(400, "Ungültige Beleg-ID");
  return passThroughFile(`billing-documents/${params.id}/preview`, {
    filename: "entwurf.pdf",
  });
};
