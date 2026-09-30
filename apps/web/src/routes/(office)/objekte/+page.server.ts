import { api, must } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim() || undefined;
  const res = await api().GET("/api/v1/objects", {
    params: { query: { q, limit: 200, offset: 0 } },
  });
  return { q: q ?? "", objects: must(res).items };
};
