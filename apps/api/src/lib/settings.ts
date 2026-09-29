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
