import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "../../lib/errors.js";
import { createRouter, ValidationError } from "../../lib/http.js";
import { datevExport, monthlyPackage, revenueReport } from "./service.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const Row = z.object({
  period: z.string(),
  netCents: z.number().int(),
  taxCents: z.number().int(),
  grossCents: z.number().int(),
  count: z.number().int(),
});

const revenue = createRoute({
  method: "get",
  path: "/reports/revenue",
  operationId: "revenueReport",
  tags: ["Auswertungen"],
  summary: "Umsatz je Monat nach Rechnungsdatum (soll) oder Zahlungseingang (ist)",
  request: {
    query: z.object({
      from: z.iso.date(),
      to: z.iso.date(),
      basis: z.enum(["soll", "ist"]).default("ist"),
    }),
  },
  responses: {
    200: {
      description: "Umsatz",
      content: json(
        z
          .object({
            basis: z.enum(["soll", "ist"]),
            from: z.string(),
            to: z.string(),
            periods: z.array(Row),
            total: Row.omit({ period: true }),
          })
          .openapi("RevenueReport"),
      ),
    },
    400: { description: "Ungültig", content: json(ValidationError) },
  },
});

const datev = createRoute({
  method: "get",
  path: "/exports/datev",
  operationId: "exportDatev",
  tags: ["Auswertungen"],
  summary: "DATEV-Buchungsstapel (EXTF 700, Windows-1252) für einen Zeitraum",
  "x-mcp": false,
  request: { query: z.object({ from: z.iso.date(), to: z.iso.date() }) },
  responses: {
    200: { description: "CSV" },
    422: { description: "Einstellungen fehlen", content: json(ErrorResponse) },
  },
});

const monthly = createRoute({
  method: "get",
  path: "/exports/monthly",
  operationId: "exportMonthlyPackage",
  tags: ["Auswertungen"],
  summary: "Monatspaket (ZIP) für die Steuerberatung: DATEV, Listen, Rechnungs-PDFs",
  "x-mcp": false,
  request: { query: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) },
  responses: { 200: { description: "ZIP" } },
});

export const reportsRouter = createRouter()
  .openapi(revenue, async (c) => {
    const { from, to, basis } = c.req.valid("query");
    return c.json(await revenueReport(c.get("db"), from, to, basis), 200);
  })
  .openapi(datev, async (c) => {
    const { from, to } = c.req.valid("query");
    const r = await datevExport(c.get("db"), from, to);
    return c.body(Buffer.from(r.bytes), 200, {
      "content-type": "text/csv; charset=windows-1252",
      "content-disposition": `attachment; filename="EXTF_Buchungsstapel_${from}_${to}.csv"`,
    });
  })
  .openapi(monthly, async (c) => {
    const { month } = c.req.valid("query");
    const r = await monthlyPackage(c.get("db"), c.get("services"), month);
    return c.body(Buffer.from(r.zip), 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="monatspaket-${month}.zip"`,
    });
  });
