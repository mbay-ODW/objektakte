CREATE TABLE "number_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	"padding" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER number_sequences_touch BEFORE UPDATE ON number_sequences FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
