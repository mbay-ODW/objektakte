import { api, must } from "$lib/server/api";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url }) => {
  const current = new Date().getFullYear();
  const y = Number(url.searchParams.get("jahr") ?? current);
  const year = Number.isInteger(y) && y > 1990 && y < 2200 ? y : current;
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const client = api();
  const [soll, ist] = await Promise.all([
    client.GET("/api/v1/reports/revenue", { params: { query: { from, to, basis: "soll" } } }),
    client.GET("/api/v1/reports/revenue", { params: { query: { from, to, basis: "ist" } } }),
  ]);
  return { year, soll: must(soll), ist: must(ist) };
};
