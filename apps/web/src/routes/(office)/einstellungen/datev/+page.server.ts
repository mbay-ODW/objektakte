import { fail } from "@sveltejs/kit";
import { api, failed, must } from "$lib/server/api";
import { int, text } from "$lib/server/forms";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async () => {
  const res = await api().GET("/api/v1/settings/datev");
  return { datev: must(res) };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const fd = await request.formData();
    const fiscalYearStart = text(fd, "fiscalYearStart") ?? "01-01";
    if (!/^\d{2}-\d{2}$/.test(fiscalYearStart)) {
      return fail(400, { error: "Beginn des Wirtschaftsjahres als MM-TT, z. B. 01-01." });
    }
    const res = await api().PUT("/api/v1/settings/datev", {
      body: {
        consultantNumber: int(fd, "consultantNumber") ?? undefined,
        clientNumber: int(fd, "clientNumber") ?? undefined,
        fiscalYearStart,
        accountLength: int(fd, "accountLength") ?? 4,
        mode: text(fd, "mode") === "soll" ? "soll" : "ist",
        bankAccount: int(fd, "bankAccount") ?? 1200,
        debtorAccount: int(fd, "debtorAccount") ?? 10000,
        revenueAccounts: {
          standard: int(fd, "revStandard") ?? 8400,
          reverseCharge: int(fd, "revReverseCharge") ?? 8337,
          exempt: int(fd, "revExempt") ?? 8100,
        },
      },
    });
    return failed(res) ?? { saved: true };
  },
};
