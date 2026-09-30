import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client.js";
import { numberSequences } from "../db/schema.js";

/**
 * Zieht die nächste Nummer eines Nummernkreises. Muss in derselben Transaktion laufen wie die
 * Verwendung der Nummer, damit bei einem Rollback keine Lücke entsteht.
 */
export async function nextNumber(
  tx: DbOrTx,
  key: string,
): Promise<{ value: number; padded: string }> {
  await tx.insert(numberSequences).values({ key }).onConflictDoNothing();
  const [row] = await tx.execute<{ next_value: string; padding: number }>(
    sql`SELECT next_value, padding FROM number_sequences WHERE key = ${key} FOR UPDATE`,
  );
  if (!row) throw new Error(`Nummernkreis ${key} nicht gefunden`);
  const value = Number(row.next_value);
  await tx
    .update(numberSequences)
    .set({ nextValue: value + 1 })
    .where(eq(numberSequences.key, key));
  return { value, padded: String(value).padStart(row.padding, "0") };
}
