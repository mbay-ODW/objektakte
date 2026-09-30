CREATE TYPE "public"."inspection_category" AS ENUM('gebaeude_allgemein', 'aussenwand', 'dach', 'oberste_geschossdecke', 'kellerdecke', 'bodenplatte', 'fenster', 'tueren', 'heizung', 'warmwasser', 'lueftung', 'kuehlung', 'beleuchtung', 'pv_solar', 'elektro', 'zone', 'sonstiges');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('laufend', 'abgeschlossen');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('gut', 'mittel', 'schlecht');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('foto', 'audio');--> statement-breakpoint
CREATE TYPE "public"."transcript_status" AS ENUM('keins', 'ausstehend', 'fertig', 'fehler');--> statement-breakpoint
ALTER TYPE "public"."document_storage" ADD VALUE 'local';--> statement-breakpoint
CREATE TABLE "inspection_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"category" "inspection_category" NOT NULL,
	"label" text NOT NULL,
	"location" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition" "item_condition",
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inspection_id" uuid NOT NULL,
	"item_id" uuid,
	"kind" "media_kind" NOT NULL,
	"document_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"caption" text,
	"taken_at" timestamp with time zone,
	"transcript_status" "transcript_status" DEFAULT 'keins' NOT NULL,
	"transcript" text,
	"transcript_error" text,
	"transcript_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"object_id" uuid NOT NULL,
	"case_id" uuid,
	"title" text NOT NULL,
	"status" "inspection_status" DEFAULT 'laufend' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weather" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"notes" text,
	"finalized_at" timestamp with time zone,
	"content_hash" text,
	"protocol_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_items" ADD CONSTRAINT "inspection_items_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_media" ADD CONSTRAINT "inspection_media_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_media" ADD CONSTRAINT "inspection_media_item_id_inspection_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inspection_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_media" ADD CONSTRAINT "inspection_media_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_protocol_document_id_documents_id_fk" FOREIGN KEY ("protocol_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_items_inspection_idx" ON "inspection_items" USING btree ("inspection_id","sort_order");--> statement-breakpoint
CREATE INDEX "inspection_media_inspection_idx" ON "inspection_media" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "inspection_media_transcript_idx" ON "inspection_media" USING btree ("transcript_status");--> statement-breakpoint
CREATE INDEX "inspections_object_idx" ON "inspections" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "inspections_case_idx" ON "inspections" USING btree ("case_id");--> statement-breakpoint
CREATE TRIGGER inspections_touch BEFORE UPDATE ON inspections FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER inspection_items_touch BEFORE UPDATE ON inspection_items FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
-- Abgeschlossene Begehungen sind unveränderlich (Positionen und Medien eingeschlossen).
CREATE OR REPLACE FUNCTION inspection_reject_if_finalized() RETURNS trigger AS $$
DECLARE
  target uuid;
  fin timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'inspections' THEN
    IF OLD.finalized_at IS NULL THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    -- Nach Abschluss ist nur das Nachtragen des Protokoll-Dokuments erlaubt.
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - 'protocol_document_id' - 'updated_at')
         = (to_jsonb(OLD) - 'protocol_document_id' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Begehung ist abgeschlossen und unveränderlich';
  END IF;

  IF TG_OP = 'DELETE' THEN
    target := OLD.inspection_id;
  ELSE
    target := NEW.inspection_id;
  END IF;
  SELECT finalized_at INTO fin FROM inspections WHERE id = target;
  IF fin IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  -- Transkripte dürfen nach Abschluss noch eintreffen.
  IF TG_TABLE_NAME = 'inspection_media' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'transcript' - 'transcript_status' - 'transcript_error' - 'transcript_attempts')
       = (to_jsonb(OLD) - 'transcript' - 'transcript_status' - 'transcript_error' - 'transcript_attempts') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Begehung ist abgeschlossen und unveränderlich';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER inspections_immutable BEFORE UPDATE OR DELETE ON inspections FOR EACH ROW EXECUTE FUNCTION inspection_reject_if_finalized();
--> statement-breakpoint
CREATE TRIGGER inspection_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON inspection_items FOR EACH ROW EXECUTE FUNCTION inspection_reject_if_finalized();
--> statement-breakpoint
CREATE TRIGGER inspection_media_immutable BEFORE INSERT OR UPDATE OR DELETE ON inspection_media FOR EACH ROW EXECUTE FUNCTION inspection_reject_if_finalized();
