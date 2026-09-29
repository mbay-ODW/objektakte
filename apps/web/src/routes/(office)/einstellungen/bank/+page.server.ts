import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { int, num, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/settings/bank");
  return { bank: must(res) };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const threshold = num(fd, "autoAllocateThreshold");
    if (threshold === null || threshold < 0 || threshold > 1) {
      return fail(400, { error: "Schwellwert zwischen 0 und 1 angeben." });
    }
    const req = (name: string, fallback: string) => text(fd, name) ?? fallback;
    const opt = (name: string) => text(fd, name) ?? undefined;
    const res = await api().PUT("/api/v1/settings/bank", {
      body: {
        autoAllocateThreshold: threshold,
        csv: {
          delimiter: (req("delimiter", ";") === "tab" ? "\t" : req("delimiter", ";")) as
            | ";"
            | ","
            | "\t",
          dateFormat: req("dateFormat", "dd.mm.yyyy") as "dd.mm.yyyy" | "yyyy-mm-dd",
          decimal: req("decimal", ",") as "," | ".",
          skipLines: int(fd, "skipLines") ?? 0,
          columns: {
            bookingDate: req("col_bookingDate", "Buchungstag"),
            valueDate: req("col_valueDate", "Valuta"),
            amount: req("col_amount", "Betrag"),
            debitCredit: opt("col_debitCredit"),
            currency: req("col_currency", "Währung"),
            counterpartyName: req("col_counterpartyName", "Name Zahlungsbeteiligter"),
            counterpartyIban: req("col_counterpartyIban", "IBAN Zahlungsbeteiligter"),
            purpose: req("col_purpose", "Verwendungszweck"),
            reference: opt("col_reference"),
            externalId: opt("col_externalId"),
          },
        },
      },
    });
    return failed(res) ?? { saved: true };
  },
};
