import { createRoute, z } from "@hono/zod-openapi";
import { and, asc, eq, lte, type SQL } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import {
  cases,
  deadlineRules,
  deadlines,
  fundingAnchor,
  fundingCases,
  fundingPrograms,
} from "../../db/schema.js";
import { addDays, todayIso } from "../../lib/dates.js";
import { changes, defined } from "../../lib/diff.js";
import { DomainError, ErrorResponse, must } from "../../lib/errors.js";
import { recordEvents } from "../../lib/events.js";
import { createRouter, UuidParam, ValidationError } from "../../lib/http.js";
import { resyncAllDeadlines, syncDeadlines } from "./engine.js";

const isoDate = z.iso.date();
const text = z.string().trim().min(1).nullish();
const Anchor = z.enum(fundingAnchor.enumValues);
const json = <T extends z.ZodType>(schema: T) => ({ "application/json": { schema } });
const errors = {
  400: { description: "Ungültig", content: json(ValidationError) },
  404: { description: "Nicht gefunden", content: json(ErrorResponse) },
  422: { description: "Fachlich ungültig", content: json(ErrorResponse) },
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const FundingProgram = z
  .object({
    code: z.string(),
    name: z.string(),
    approvalPeriodMonths: z.number().int().nullable(),
    active: z.boolean(),
  })
  .openapi("FundingProgram");

const fundingFields = {
  guideline: text,
  applicationId: text,
  tpbId: text,
  tpbCreatedAt: isoDate.nullish(),
  bzaCreatedAt: isoDate.nullish(),
  appliedAt: isoDate.nullish(),
  approvedAt: isoDate.nullish(),
  approvalValidUntil: isoDate.nullish(),
  measureCompletedAt: isoDate.nullish(),
  tpnId: text,
  tpnCreatedAt: isoDate.nullish(),
  proofSubmittedAt: isoDate.nullish(),
  paidOutAt: isoDate.nullish(),
  isfpDate: isoDate.nullish(),
  eligibleCostsCents: z.number().int().nonnegative().nullish(),
  approvedAmountCents: z.number().int().nonnegative().nullish(),
  ratePercent: z.number().min(0).max(100).nullish(),
  bonuses: z.array(z.string().trim().min(1)).optional(),
  notes: text,
};

const FundingCaseCreate = z
  .object({ programCode: z.string().min(1), ...fundingFields })
  .openapi("FundingCaseCreate");
const FundingCasePatch = z
  .object({ programCode: z.string().min(1).optional(), ...fundingFields })
  .openapi("FundingCasePatch");

const Deadline = z
  .object({
    id: z.uuid(),
    caseId: z.uuid().nullable(),
    caseNumber: z.string().nullable(),
    fundingCaseId: z.uuid().nullable(),
    ruleId: z.uuid().nullable(),
    title: z.string(),
    dueDate: z.string(),
    remindFrom: z.string().nullable(),
    status: z.enum(["offen", "erledigt", "verworfen"]),
    completedAt: z.string().nullable(),
    note: z.string().nullable(),
  })
  .openapi("Deadline");

const FundingCase = z
  .object({
    id: z.uuid(),
    caseId: z.uuid(),
    programCode: z.string(),
    guideline: z.string().nullable(),
    applicationId: z.string().nullable(),
    tpbId: z.string().nullable(),
    tpbCreatedAt: z.string().nullable(),
    bzaCreatedAt: z.string().nullable(),
    appliedAt: z.string().nullable(),
    approvedAt: z.string().nullable(),
    approvalValidUntil: z.string().nullable(),
    measureCompletedAt: z.string().nullable(),
    tpnId: z.string().nullable(),
    tpnCreatedAt: z.string().nullable(),
    proofSubmittedAt: z.string().nullable(),
    paidOutAt: z.string().nullable(),
    isfpDate: z.string().nullable(),
    eligibleCostsCents: z.number().nullable(),
    approvedAmountCents: z.number().nullable(),
    ratePercent: z.number().nullable(),
    bonuses: z.array(z.string()),
    notes: z.string().nullable(),
    deadlines: z.array(Deadline),
  })
  .openapi("FundingCase");

const DeadlineRuleInput = z
  .object({
    programCode: z.string().min(1).openapi({ description: 'Programmcode oder "*"' }),
    guideline: text,
    anchor: Anchor,
    offsetMonths: z.number().int().default(0),
    offsetDays: z.number().int().default(0),
    leadDays: z.number().int().min(0).default(30),
    doneWhen: Anchor.nullish(),
    title: z.string().trim().min(1),
    description: text,
    sourceNote: text,
    active: z.boolean().default(true),
  })
  .openapi("DeadlineRuleInput");

const DeadlineRule = DeadlineRuleInput.extend({
  id: z.uuid(),
  guideline: z.string().nullable(),
  doneWhen: Anchor.nullable(),
  description: z.string().nullable(),
  sourceNote: z.string().nullable(),
}).openapi("DeadlineRule");

const DeadlineCreate = z
  .object({
    caseId: z.uuid().nullish(),
    title: z.string().trim().min(1),
    dueDate: isoDate,
    remindFrom: isoDate.nullish(),
    note: text,
  })
  .openapi("DeadlineCreate");

const DeadlinePatch = z
  .object({
    title: z.string().trim().min(1).optional(),
    dueDate: isoDate.optional(),
    remindFrom: isoDate.nullish(),
    status: z.enum(["offen", "erledigt", "verworfen"]).optional(),
    note: text,
  })
  .openapi("DeadlinePatch");

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function toDbFunding(input: Record<string, unknown>) {
  const { ratePercent, ...rest } = input;
  return ratePercent === undefined
    ? rest
    : { ...rest, ratePercent: ratePercent === null ? null : String(ratePercent) };
}

async function assertProgram(tx: DbOrTx, code: string | undefined) {
  if (!code) return;
  const [p] = await tx.select().from(fundingPrograms).where(eq(fundingPrograms.code, code));
  if (!p) throw new DomainError(422, `Unbekanntes Förderprogramm "${code}"`);
}

const deadlineColumns = {
  id: deadlines.id,
  caseId: deadlines.caseId,
  caseNumber: cases.number,
  fundingCaseId: deadlines.fundingCaseId,
  ruleId: deadlines.ruleId,
  title: deadlines.title,
  dueDate: deadlines.dueDate,
  remindFrom: deadlines.remindFrom,
  status: deadlines.status,
  completedAt: deadlines.completedAt,
  note: deadlines.note,
};

function selectDeadlines(db: DbOrTx, where: SQL | undefined) {
  return db
    .select(deadlineColumns)
    .from(deadlines)
    .leftJoin(cases, eq(cases.id, deadlines.caseId))
    .where(where)
    .orderBy(asc(deadlines.dueDate), asc(deadlines.title));
}

export async function loadFundingCase(db: DbOrTx, id: string) {
  const [fc] = await db.select().from(fundingCases).where(eq(fundingCases.id, id));
  if (!fc) return undefined;
  const list = await selectDeadlines(db, eq(deadlines.fundingCaseId, id));
  return {
    ...fc,
    eligibleCostsCents: fc.eligibleCostsCents,
    approvedAmountCents: fc.approvedAmountCents,
    ratePercent: fc.ratePercent == null ? null : Number(fc.ratePercent),
    deadlines: list,
  } satisfies Omit<z.infer<typeof FundingCase>, "createdAt"> & Record<string, unknown>;
}

const toFundingCase = (fc: NonNullable<Awaited<ReturnType<typeof loadFundingCase>>>) =>
  FundingCase.parse(fc);

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------

const listPrograms = createRoute({
  method: "get",
  path: "/funding-programs",
  operationId: "listFundingPrograms",
  tags: ["Förderung"],
  summary: "Förderprogramme",
  responses: {
    200: { description: "Programme", content: json(z.object({ items: z.array(FundingProgram) })) },
  },
});

const upsertProgram = createRoute({
  method: "put",
  path: "/funding-programs/{code}",
  operationId: "upsertFundingProgram",
  tags: ["Förderung"],
  summary: "Förderprogramm anlegen oder ändern",
  request: {
    params: z.object({
      code: z
        .string()
        .regex(/^[a-z0-9_]+$/)
        .openapi({ param: { name: "code", in: "path" } }),
    }),
    body: {
      required: true,
      content: json(
        z.object({
          name: z.string().trim().min(1),
          approvalPeriodMonths: z.number().int().positive().nullish(),
          active: z.boolean().default(true),
        }),
      ),
    },
  },
  responses: {
    200: { description: "Gespeichert", content: json(FundingProgram) },
    400: errors[400],
  },
});

const createFunding = createRoute({
  method: "post",
  path: "/cases/{id}/funding-cases",
  operationId: "createFundingCase",
  tags: ["Förderung"],
  summary: "Förderfall zu einem Vorgang anlegen; Fristen werden automatisch berechnet",
  request: { params: UuidParam, body: { required: true, content: json(FundingCaseCreate) } },
  responses: { 201: { description: "Angelegt", content: json(FundingCase) }, ...errors },
});

const listFunding = createRoute({
  method: "get",
  path: "/funding-cases",
  operationId: "listFundingCases",
  tags: ["Förderung"],
  summary: "Förderfälle (optional je Vorgang)",
  request: { query: z.object({ caseId: z.uuid().optional() }) },
  responses: {
    200: { description: "Förderfälle", content: json(z.object({ items: z.array(FundingCase) })) },
  },
});

const getFunding = createRoute({
  method: "get",
  path: "/funding-cases/{id}",
  operationId: "getFundingCase",
  tags: ["Förderung"],
  summary: "Förderfall mit Fristen",
  request: { params: UuidParam },
  responses: { 200: { description: "Förderfall", content: json(FundingCase) }, 404: errors[404] },
});

const patchFunding = createRoute({
  method: "patch",
  path: "/funding-cases/{id}",
  operationId: "updateFundingCase",
  tags: ["Förderung"],
  summary: "Förderfall ändern (z. B. Zusagedatum, TPN); Fristen werden neu berechnet",
  request: { params: UuidParam, body: { required: true, content: json(FundingCasePatch) } },
  responses: { 200: { description: "Geändert", content: json(FundingCase) }, ...errors },
});

const listRules = createRoute({
  method: "get",
  path: "/deadline-rules",
  operationId: "listDeadlineRules",
  tags: ["Fristen"],
  summary: "Fristenregeln",
  responses: {
    200: { description: "Regeln", content: json(z.object({ items: z.array(DeadlineRule) })) },
  },
});

const createRule = createRoute({
  method: "post",
  path: "/deadline-rules",
  operationId: "createDeadlineRule",
  tags: ["Fristen"],
  summary: "Fristenregel anlegen; betroffene Förderfälle werden neu berechnet",
  request: { body: { required: true, content: json(DeadlineRuleInput) } },
  responses: { 201: { description: "Angelegt", content: json(DeadlineRule) }, 400: errors[400] },
});

const patchRule = createRoute({
  method: "patch",
  path: "/deadline-rules/{id}",
  operationId: "updateDeadlineRule",
  tags: ["Fristen"],
  summary: "Fristenregel ändern oder deaktivieren",
  request: {
    params: UuidParam,
    body: { required: true, content: json(DeadlineRuleInput.partial()) },
  },
  responses: { 200: { description: "Geändert", content: json(DeadlineRule) }, ...errors },
});

const listDeadlines = createRoute({
  method: "get",
  path: "/deadlines",
  operationId: "listDeadlines",
  tags: ["Fristen"],
  summary: "Fristen und Wiedervorlagen filtern",
  request: {
    query: z.object({
      status: z.enum(["offen", "erledigt", "verworfen"]).optional(),
      caseId: z.uuid().optional(),
      dueBefore: isoDate.optional(),
    }),
  },
  responses: {
    200: { description: "Fristen", content: json(z.object({ items: z.array(Deadline) })) },
  },
});

const digest = createRoute({
  method: "get",
  path: "/deadlines/digest",
  operationId: "deadlineDigest",
  tags: ["Fristen"],
  summary: "Überfällige, bald fällige und in der Erinnerungsphase befindliche offene Fristen",
  request: {
    query: z.object({
      days: z.coerce.number().int().min(0).max(365).default(14),
      today: isoDate.optional().openapi({ description: "Stichtag (Standard: heute)" }),
    }),
  },
  responses: {
    200: {
      description: "Übersicht",
      content: json(
        z
          .object({
            today: z.string(),
            overdue: z.array(Deadline),
            dueSoon: z.array(Deadline),
            reminders: z.array(Deadline),
          })
          .openapi("DeadlineDigest"),
      ),
    },
  },
});

const createDeadline = createRoute({
  method: "post",
  path: "/deadlines",
  operationId: "createDeadline",
  tags: ["Fristen"],
  summary: "Manuelle Frist/Wiedervorlage anlegen",
  request: { body: { required: true, content: json(DeadlineCreate) } },
  responses: { 201: { description: "Angelegt", content: json(Deadline) }, 400: errors[400] },
});

const patchDeadline = createRoute({
  method: "patch",
  path: "/deadlines/{id}",
  operationId: "updateDeadline",
  tags: ["Fristen"],
  summary: "Frist ändern, erledigen oder verwerfen",
  request: { params: UuidParam, body: { required: true, content: json(DeadlinePatch) } },
  responses: { 200: { description: "Geändert", content: json(Deadline) }, ...errors },
});

async function loadDeadline(db: DbOrTx, id: string) {
  const [row] = await selectDeadlines(db, eq(deadlines.id, id));
  return row;
}

export const fundingRouter = createRouter()
  .openapi(listPrograms, async (c) => {
    const items = await c
      .get("db")
      .select()
      .from(fundingPrograms)
      .orderBy(asc(fundingPrograms.code));
    return c.json({ items }, 200);
  })
  .openapi(upsertProgram, async (c) => {
    const { code } = c.req.valid("param");
    const body = c.req.valid("json");
    const values = {
      code,
      name: body.name,
      approvalPeriodMonths: body.approvalPeriodMonths ?? null,
      active: body.active,
    };
    const [row] = await c.get("db").transaction(async (tx) => {
      const r = await tx
        .insert(fundingPrograms)
        .values(values)
        .onConflictDoUpdate({ target: fundingPrograms.code, set: values })
        .returning();
      await resyncAllDeadlines(tx, code, c.get("actor"));
      return r;
    });
    return c.json(row as z.infer<typeof FundingProgram>, 200);
  })
  .openapi(createFunding, async (c) => {
    const db = c.get("db");
    const { id: caseId } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("actor");
    const id = await db.transaction(async (tx) => {
      const [kase] = await tx.select({ id: cases.id }).from(cases).where(eq(cases.id, caseId));
      if (!kase) throw new DomainError(404, "Vorgang nicht gefunden");
      await assertProgram(tx, body.programCode);
      const [row] = await tx
        .insert(fundingCases)
        .values({ ...(toDbFunding(defined(body)) as typeof fundingCases.$inferInsert), caseId })
        .returning({ id: fundingCases.id });
      if (!row) throw new Error("Förderfall konnte nicht angelegt werden");
      await recordEvents(tx, [
        {
          entityType: "funding_case",
          entityId: row.id,
          type: "funding_case.created",
          actor,
          payload: { caseId, programCode: body.programCode },
        },
      ]);
      await syncDeadlines(tx, row.id, actor);
      return row.id;
    });
    return c.json(toFundingCase(must(await loadFundingCase(db, id), "Förderfall")), 201);
  })
  .openapi(listFunding, async (c) => {
    const db = c.get("db");
    const { caseId } = c.req.valid("query");
    const rows = await db
      .select({ id: fundingCases.id })
      .from(fundingCases)
      .where(caseId ? eq(fundingCases.caseId, caseId) : undefined)
      .orderBy(asc(fundingCases.createdAt));
    const items = [];
    for (const r of rows)
      items.push(toFundingCase(must(await loadFundingCase(db, r.id), "Förderfall")));
    return c.json({ items }, 200);
  })
  .openapi(getFunding, async (c) => {
    const fc = await loadFundingCase(c.get("db"), c.req.valid("param").id);
    if (!fc) return c.json({ error: "not_found", message: "Förderfall nicht gefunden" }, 404);
    return c.json(toFundingCase(fc), 200);
  })
  .openapi(patchFunding, async (c) => {
    const db = c.get("db");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("actor");
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(fundingCases).where(eq(fundingCases.id, id));
      if (!before) throw new DomainError(404, "Förderfall nicht gefunden");
      await assertProgram(tx, body.programCode);
      const set = toDbFunding(defined(body));
      const diff = changes(before, set);
      if (Object.keys(diff).length === 0) return;
      await tx.update(fundingCases).set(set).where(eq(fundingCases.id, id));
      await recordEvents(tx, [
        {
          entityType: "funding_case",
          entityId: id,
          type: "funding_case.updated",
          actor,
          payload: { changes: diff },
        },
      ]);
      await syncDeadlines(tx, id, actor);
    });
    return c.json(toFundingCase(must(await loadFundingCase(db, id), "Förderfall")), 200);
  })
  .openapi(listRules, async (c) => {
    const items = await c
      .get("db")
      .select()
      .from(deadlineRules)
      .orderBy(asc(deadlineRules.programCode), asc(deadlineRules.title));
    return c.json({ items: items.map((r) => DeadlineRule.parse(r)) }, 200);
  })
  .openapi(createRule, async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("actor");
    const row = await c.get("db").transaction(async (tx) => {
      if (body.programCode !== "*") await assertProgram(tx, body.programCode);
      const [r] = await tx
        .insert(deadlineRules)
        .values({
          ...body,
          guideline: body.guideline ?? null,
          doneWhen: body.doneWhen ?? null,
          description: body.description ?? null,
          sourceNote: body.sourceNote ?? null,
        })
        .returning();
      if (!r) throw new Error("Regel konnte nicht angelegt werden");
      await recordEvents(tx, [
        {
          entityType: "deadline_rule",
          entityId: r.id,
          type: "deadline_rule.created",
          actor,
          payload: body,
        },
      ]);
      await resyncAllDeadlines(tx, r.programCode, actor);
      return r;
    });
    return c.json(DeadlineRule.parse(row), 201);
  })
  .openapi(patchRule, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("actor");
    const row = await c.get("db").transaction(async (tx) => {
      const [before] = await tx.select().from(deadlineRules).where(eq(deadlineRules.id, id));
      if (!before) throw new DomainError(404, "Regel nicht gefunden");
      if (body.programCode && body.programCode !== "*") await assertProgram(tx, body.programCode);
      const set = defined(body);
      const [r] = await tx
        .update(deadlineRules)
        .set(set)
        .where(eq(deadlineRules.id, id))
        .returning();
      await recordEvents(tx, [
        {
          entityType: "deadline_rule",
          entityId: id,
          type: "deadline_rule.updated",
          actor,
          payload: { changes: changes(before, set) },
        },
      ]);
      // Alte und neue Programmzuordnung neu berechnen.
      await resyncAllDeadlines(tx, before.programCode, actor);
      if (r && r.programCode !== before.programCode)
        await resyncAllDeadlines(tx, r.programCode, actor);
      return r;
    });
    return c.json(DeadlineRule.parse(row), 200);
  })
  .openapi(listDeadlines, async (c) => {
    const { status, caseId, dueBefore } = c.req.valid("query");
    const filters: SQL[] = [];
    if (status) filters.push(eq(deadlines.status, status));
    if (caseId) filters.push(eq(deadlines.caseId, caseId));
    if (dueBefore) filters.push(lte(deadlines.dueDate, dueBefore));
    const items = await selectDeadlines(c.get("db"), and(...filters));
    return c.json({ items }, 200);
  })
  .openapi(digest, async (c) => {
    const { days, today: todayParam } = c.req.valid("query");
    const today = todayParam ?? todayIso();
    const horizon = addDays(today, days);
    const open = await selectDeadlines(c.get("db"), eq(deadlines.status, "offen"));
    const overdue = open.filter((d) => d.dueDate < today);
    const dueSoon = open.filter((d) => d.dueDate >= today && d.dueDate <= horizon);
    const reminders = open.filter(
      (d) => d.dueDate > horizon && d.remindFrom !== null && d.remindFrom <= today,
    );
    return c.json({ today, overdue, dueSoon, reminders }, 200);
  })
  .openapi(createDeadline, async (c) => {
    const body = c.req.valid("json");
    const actor = c.get("actor");
    const db = c.get("db");
    const id = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(deadlines)
        .values({
          caseId: body.caseId ?? null,
          title: body.title,
          dueDate: body.dueDate,
          remindFrom: body.remindFrom ?? null,
          note: body.note ?? null,
        })
        .returning({ id: deadlines.id });
      if (!r) throw new Error("Frist konnte nicht angelegt werden");
      await recordEvents(tx, [
        {
          entityType: "deadline",
          entityId: r.id,
          type: "deadline.created",
          actor,
          payload: { title: body.title, dueDate: body.dueDate, manual: true },
        },
      ]);
      return r.id;
    });
    return c.json(must(await loadDeadline(db, id), "Frist"), 201);
  })
  .openapi(patchDeadline, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const actor = c.get("actor");
    const db = c.get("db");
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(deadlines).where(eq(deadlines.id, id));
      if (!before) throw new DomainError(404, "Frist nicht gefunden");
      const set: Partial<typeof deadlines.$inferInsert> = defined(body);
      if (body.status === "erledigt" && before.status !== "erledigt") set.completedAt = todayIso();
      if (body.status && body.status !== "erledigt") set.completedAt = null;
      // Manuelle Statusänderung übersteuert die Regel-Erledigung.
      if (body.status) set.completedByRule = false;
      const diff = changes(before, set);
      if (Object.keys(diff).length === 0) return;
      await tx.update(deadlines).set(set).where(eq(deadlines.id, id));
      await recordEvents(tx, [
        {
          entityType: "deadline",
          entityId: id,
          type: "deadline.updated",
          actor,
          payload: { changes: diff },
        },
      ]);
    });
    return c.json(must(await loadDeadline(db, id), "Frist"), 200);
  });
