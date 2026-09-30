CREATE TYPE "public"."assignment_status" AS ENUM('offen', 'automatisch', 'bestaetigt', 'ignoriert');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "assignment_status" "assignment_status" DEFAULT 'offen' NOT NULL;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "match_reason" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "match_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "participants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "communication_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_communication_id_communications_id_fk" FOREIGN KEY ("communication_id") REFERENCES "public"."communications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "communications_source_ref_uq" ON "communications" USING btree ("source","source_ref") WHERE "communications"."source_ref" is not null;--> statement-breakpoint
CREATE INDEX "communications_inbox_idx" ON "communications" USING btree ("assignment_status","occurred_at");--> statement-breakpoint
CREATE TRIGGER app_settings_touch BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
