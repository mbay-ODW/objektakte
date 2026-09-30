import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { bool, int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/settings/company");
  return { company: must(res) };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const s = (name: string) => text(fd, name) ?? "";
    const country = s("country").toUpperCase() || "DE";
    if (country.length !== 2)
      return fail(400, { error: "Land als zweistelliger Code (z. B. DE)." });
    const res = await api().PUT("/api/v1/settings/company", {
      body: {
        name: s("name"),
        street: s("street"),
        postalCode: s("postalCode"),
        city: s("city"),
        country,
        vatId: text(fd, "vatId"),
        taxNumber: text(fd, "taxNumber"),
        sellerId: text(fd, "sellerId"),
        email: s("email"),
        phone: s("phone"),
        contactName: s("contactName"),
        website: text(fd, "website"),
        bankName: text(fd, "bankName"),
        iban: text(fd, "iban")?.replace(/\s+/g, "") ?? null,
        bic: text(fd, "bic"),
        smallBusiness: bool(fd, "smallBusiness"),
        paymentDays: int(fd, "paymentDays") ?? 14,
        numberPatterns: {
          angebot: s("pattern_angebot") || "ANG-{YYYY}-{N}",
          auftragsbestaetigung: s("pattern_auftragsbestaetigung") || "AB-{YYYY}-{N}",
          rechnung: s("pattern_rechnung") || "RE-{YYYY}-{N}",
          zahlungserinnerung: s("pattern_zahlungserinnerung") || "ZE-{YYYY}-{N}",
        },
        texts: {
          invoiceIntro: s("invoiceIntro"),
          invoiceClosing: s("invoiceClosing"),
          offerIntro: s("offerIntro"),
          offerClosing: s("offerClosing"),
          reminder: [s("reminder1"), s("reminder2"), s("reminder3")],
        },
      },
    });
    return failed(res) ?? { saved: true };
  },
};
