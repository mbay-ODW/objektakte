CREATE TYPE "public"."deadline_status" AS ENUM('offen', 'erledigt', 'verworfen');--> statement-breakpoint
CREATE TYPE "public"."funding_anchor" AS ENUM('tpb_created_at', 'bza_created_at', 'applied_at', 'approved_at', 'approval_valid_until', 'measure_completed_at', 'tpn_created_at', 'proof_submitted_at', 'isfp_date');--> statement-breakpoint
CREATE TABLE "deadline_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_code" text NOT NULL,
	"guideline" text,
	"anchor" "funding_anchor" NOT NULL,
	"offset_months" integer DEFAULT 0 NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"lead_days" integer DEFAULT 30 NOT NULL,
	"done_when" "funding_anchor",
	"title" text NOT NULL,
	"description" text,
	"source_note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"funding_case_id" uuid,
	"rule_id" uuid,
	"title" text NOT NULL,
	"due_date" date NOT NULL,
	"remind_from" date,
	"status" "deadline_status" DEFAULT 'offen' NOT NULL,
	"completed_at" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"program_code" text NOT NULL,
	"guideline" text,
	"application_id" text,
	"tpb_id" text,
	"tpb_created_at" date,
	"bza_created_at" date,
	"applied_at" date,
	"approved_at" date,
	"approval_valid_until" date,
	"measure_completed_at" date,
	"tpn_id" text,
	"tpn_created_at" date,
	"proof_submitted_at" date,
	"paid_out_at" date,
	"isfp_date" date,
	"eligible_costs_cents" bigint,
	"approved_amount_cents" bigint,
	"rate_percent" numeric(5, 2),
	"bonuses" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_programs" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"approval_period_months" integer,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"event_types" text[] DEFAULT '{*}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_event_id" bigint DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_funding_case_id_funding_cases_id_fk" FOREIGN KEY ("funding_case_id") REFERENCES "public"."funding_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_rule_id_deadline_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."deadline_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_cases" ADD CONSTRAINT "funding_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_cases" ADD CONSTRAINT "funding_cases_program_code_funding_programs_code_fk" FOREIGN KEY ("program_code") REFERENCES "public"."funding_programs"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deadlines_rule_uq" ON "deadlines" USING btree ("funding_case_id","rule_id") WHERE "deadlines"."rule_id" is not null;--> statement-breakpoint
CREATE INDEX "deadlines_due_idx" ON "deadlines" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "deadlines_case_idx" ON "deadlines" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "funding_cases_case_idx" ON "funding_cases" USING btree ("case_id");