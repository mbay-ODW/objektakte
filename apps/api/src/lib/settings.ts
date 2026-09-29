import { z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client.js";
import { appSettings } from "../db/schema.js";

/** Bekannte Einstellungsbereiche mit Schema und Standardwerten. */
export const settingSchemas = {
  communication: z
    .object({
      /** Eigene Adressen/Nummern – werden bei der Zuordnung nie als Gegenüber gewertet. */
      ownAddresses: z.array(z.string()).default([]),
      /** Adressen, deren Nachrichten automatisch ignoriert werden (Newsletter, Systemmails). */
      ignoredAddresses: z.array(z.string()).default([]),
      /** Ab dieser Konfidenz wird automatisch zugeordnet. */
      autoAssignThreshold: z.number().min(0).max(1).default(0.7),
    })
    .openapi("CommunicationSettings"),
  bank: z
    .object({
      /** Ab dieser Konfidenz werden Zahlungen automatisch zugeordnet. */
      autoAllocateThreshold: z.number().min(0).max(1).default(0.8),
      /** Spaltenzuordnung für den CSV-Import (Standard: übliches deutsches Bankformat). */
      csv: z
        .object({
          delimiter: z.enum([";", ",", "\t"]).default(";"),
          dateFormat: z.enum(["dd.mm.yyyy", "yyyy-mm-dd"]).default("dd.mm.yyyy"),
          decimal: z.enum([",", "."]).default(","),
          skipLines: z.number().int().min(0).default(0),
          columns: z
            .object({
              bookingDate: z.string().default("Buchungstag"),
              valueDate: z.string().optional().default("Valuta"),
              amount: z.string().default("Betrag"),
              debitCredit: z.string().optional(),
              currency: z.string().optional().default("Währung"),
              counterpartyName: z.string().optional().default("Name Zahlungsbeteiligter"),
              counterpartyIban: z.string().optional().default("IBAN Zahlungsbeteiligter"),
              purpose: z.string().default("Verwendungszweck"),
              reference: z.string().optional(),
              externalId: z.string().optional(),
            })
            .default({
              bookingDate: "Buchungstag",
              valueDate: "Valuta",
              amount: "Betrag",
              currency: "Währung",
              counterpartyName: "Name Zahlungsbeteiligter",
              counterpartyIban: "IBAN Zahlungsbeteiligter",
              purpose: "Verwendungszweck",
            }),
        })
        .default({
          delimiter: ";",
          dateFormat: "dd.mm.yyyy",
          decimal: ",",
          skipLines: 0,
          columns: {
            bookingDate: "Buchungstag",
            valueDate: "Valuta",
            amount: "Betrag",
            currency: "Währung",
            counterpartyName: "Name Zahlungsbeteiligter",
            counterpartyIban: "IBAN Zahlungsbeteiligter",
            purpose: "Verwendungszweck",
          },
        }),
    })
    .openapi("BankSettings"),
  datev: z
    .object({
      consultantNumber: z.number().int().min(1000).max(9999999).optional(),
      clientNumber: z.number().int().min(1).max(99999).optional(),
      /** Beginn des Wirtschaftsjahres als MM-TT */
      fiscalYearStart: z
        .string()
        .regex(/^\d{2}-\d{2}$/)
        .default("01-01"),
      accountLength: z.number().int().min(4).max(8).default(4),
      /** "ist" = Buchung bei Zahlungseingang (EÜR), "soll" = Buchung bei Rechnungsstellung */
      mode: z.enum(["ist", "soll"]).default("ist"),
      bankAccount: z.number().int().default(1200),
      debtorAccount: z.number().int().default(10000),
      /** Erlöskonten nach Steuerkategorie (Automatikkonten, SKR03-Standard) */
      revenueAccounts: z
        .object({
          standard: z.number().int().default(8400),
          reverseCharge: z.number().int().default(8337),
          exempt: z.number().int().default(8100),
        })
        .default({ standard: 8400, reverseCharge: 8337, exempt: 8100 }),
    })
    .openapi("DatevSettings"),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export async function getSetting<K extends SettingKey>(
  db: DbOrTx,
  key: K,
): Promise<SettingValue<K>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return settingSchemas[key].parse(row?.value ?? {}) as SettingValue<K>;
}

export async function putSetting<K extends SettingKey>(
  db: DbOrTx,
  key: K,
  value: unknown,
): Promise<SettingValue<K>> {
  const parsed = settingSchemas[key].parse(value) as SettingValue<K>;
  await db
    .insert(appSettings)
    .values({ key, value: parsed })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed } });
  return parsed;
}
