import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, cents, num, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

type Category = "S" | "Z" | "E" | "AE" | "O";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/articles");
  return { items: must(res).items };
};

export const actions: Actions = {
  save: async ({ request }) => {
    const fd = await request.formData();
    const code = text(fd, "code");
    const name = text(fd, "name");
    const price = cents(fd, "price");
    if (!code || !/^[A-Za-z0-9._-]{1,40}$/.test(code)) {
      return fail(400, { error: "Kürzel: 1–40 Zeichen (Buchstaben, Ziffern, . _ -)." });
    }
    if (!name || price === null) return fail(400, { error: "Bezeichnung und Preis angeben." });
    const taxCategory = (text(fd, "taxCategory") ?? "S") as Category;
    const res = await api().PUT("/api/v1/articles/{code}", {
      params: { path: { code } },
      body: {
        name,
        description: text(fd, "description"),
        unitCode: text(fd, "unitCode") ?? "C62",
        unitPriceCents: price,
        taxCategory,
        taxRatePercent: taxCategory === "S" ? (num(fd, "taxRatePercent") ?? 19) : 0,
        active: bool(fd, "active"),
      },
    });
    return failed(res) ?? { saved: true };
  },
};
