import { createRoute, z } from "@hono/zod-openapi";
import { asc, eq, sql } from "drizzle-orm";
import { measureTypes, numberSequences } from "../../db/schema.js";
import { recordEvents, settingEntityId } from "../../lib/events.js";
import { createRouter, ValidationError } from "../../lib/http.js";

const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });

const MeasureType = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
});

const NumberSequence = z
  .object({ key: z.string(), nextValue: z.number().int(), padding: z.number().int() })
  .openapi("NumberSequence");

const keyParam = (name: string, pattern: RegExp) =>
  z.object({
    [name]: z
      .string()
      .regex(pattern)
      .openapi({ param: { name, in: "path" } }),
  });

const upsertMeasure = createRoute({
  method: "put",
  path: "/measure-types/{code}",
  operationId: "upsertMeasureType",
  tags: ["Einstellungen"],
  summary: "Leistungsart anlegen oder ändern",
  request: {
    params: keyParam("code", /^[A-Za-zÄÖÜäöü0-9_]{1,20}$/),
    body: {
      required: true,
      content: json(
        z.object({
          name: z.string().trim().min(1),
          description: z.string().trim().min(1).nullish(),
          active: z.boolean().default(true),
        }),
      ),
    },
  },
  responses: {
    200: { description: "Gespeichert", content: json(MeasureType) },
    400: { description: "Ungültig", content: json(ValidationError) },
  },
});

const listSequences = createRoute({
  method: "get",
  path: "/number-sequences",
  operationId: "listNumberSequences",
  tags: ["Einstellungen"],
  summary: "Nummernkreise",
  responses: {
    200: {
      description: "Nummernkreise",
      content: json(z.object({ items: z.array(NumberSequence) })),
    },
  },
});

const setSequence = createRoute({
  method: "put",
  path: "/number-sequences/{key}",
  operationId: "setNumberSequence",
  tags: ["Einstellungen"],
  summary:
    "Nummernkreis setzen (z. B. Fortsetzung eines bestehenden Nummernkreises). Nur erhöhen möglich.",
  request: {
    params: keyParam("key", /^[a-z0-9_:.-]{1,60}$/),
    body: {
      required: true,
      content: json(
        z.object({
          nextValue: z.number().int().positive(),
          padding: z.number().int().min(0).max(10).default(0),
        }),
      ),
    },
  },
  responses: {
    200: { description: "Gespeichert", content: json(NumberSequence) },
    400: { description: "Ungültig", content: json(ValidationError) },
    409: {
      description: "Wert kleiner als der aktuelle Stand",
      content: json(z.object({ error: z.string(), message: z.string() })),
    },
  },
});

export const settingsRouter = createRouter()
  .openapi(upsertMeasure, async (c) => {
    const { code } = c.req.valid("param");
    const body = c.req.valid("json");
    const values = {
      code: code as string,
      name: body.name,
      description: body.description ?? null,
      active: body.active,
    };
    const [row] = await c
      .get("db")
      .insert(measureTypes)
      .values(values)
      .onConflictDoUpdate({ target: measureTypes.code, set: values })
      .returning();
    return c.json(row as z.infer<typeof MeasureType>, 200);
  })
  .openapi(listSequences, async (c) => {
    const rows = await c.get("db").select().from(numberSequences).orderBy(asc(numberSequences.key));
    return c.json(
      { items: rows.map((r) => ({ key: r.key, nextValue: r.nextValue, padding: r.padding })) },
      200,
    );
  })
  .openapi(setSequence, async (c) => {
    const key = c.req.valid("param").key as string;
    const { nextValue, padding } = c.req.valid("json");
    const result = await c.get("db").transaction(async (tx) => {
      await tx.insert(numberSequences).values({ key, nextValue: 1, padding }).onConflictDoNothing();
      const [current] = await tx.execute<{ next_value: string }>(
        // Sperre, damit parallel laufende Vergaben nicht zurückgesetzt werden.
        sqlLock(key),
      );
      if (current && Number(current.next_value) > nextValue) return "conflict" as const;
      const [row] = await tx
        .update(numberSequences)
        .set({ nextValue, padding })
        .where(eqKey(key))
        .returning();
      // Sprünge im Nummernkreis müssen nachvollziehbar sein (GoBD)
      await recordEvents(tx, [
        {
          entityType: "setting",
          entityId: settingEntityId(`sequence:${key}`),
          type: "number_sequence.changed",
          actor: c.get("actor"),
          payload: { key, from: current ? Number(current.next_value) : 1, to: nextValue, padding },
        },
      ]);
      return row;
    });
    if (result === "conflict" || !result) {
      return c.json(
        {
          error: "conflict",
          message:
            "Nummernkreise dürfen nicht zurückgesetzt werden (Lückenlosigkeit/Eindeutigkeit)",
        },
        409,
      );
    }
    return c.json({ key: result.key, nextValue: result.nextValue, padding: result.padding }, 200);
  });

function sqlLock(key: string) {
  return sql`SELECT next_value FROM number_sequences WHERE key = ${key} FOR UPDATE`;
}
function eqKey(key: string) {
  return eq(numberSequences.key, key);
}
