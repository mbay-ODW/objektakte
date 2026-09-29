CREATE TYPE "public"."billing_doc_source" AS ENUM('nativ', 'import');--> statement-breakpoint
CREATE TYPE "public"."billing_doc_status" AS ENUM('entwurf', 'festgeschrieben', 'versendet', 'storniert');--> statement-breakpoint
CREATE TYPE "public"."billing_doc_type" AS ENUM('angebot', 'auftragsbestaetigung', 'rechnung', 'abschlagsrechnung', 'schlussrechnung', 'stornorechnung', 'gutschrift', 'zahlungserinnerung', 'zahlungsbestaetigung');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('anfrage', 'angebot', 'beauftragt', 'in_bearbeitung', 'abrechnung', 'abgeschlossen', 'storniert');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('email', 'phone', 'mobile', 'whatsapp', 'signal', 'fax', 'website');--> statement-breakpoint
CREATE TYPE "public"."comm_channel" AS ENUM('email', 'whatsapp', 'signal', 'telefon', 'vor_ort', 'brief', 'notiz');--> statement-breakpoint
CREATE TYPE "public"."comm_direction" AS ENUM('eingehend', 'ausgehend', 'intern');--> statement-breakpoint
CREATE TYPE "public"."contact_kind" AS ENUM('person', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."document_storage" AS ENUM('nextcloud', 'paperless', 'url');--> statement-breakpoint
CREATE TYPE "public"."object_role" AS ENUM('eigentuemer', 'verwaltung', 'nutzer', 'ansprechpartner', 'handwerker', 'planer', 'sonstige');--> statement-breakpoint
CREATE TYPE "public"."object_usage" AS ENUM('wohngebaeude', 'nichtwohngebaeude', 'gemischt', 'unbekannt');--> statement-breakpoint
CREATE TABLE "billing_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "billing_doc_type" NOT NULL,
	"number" text,
	"case_id" uuid,
	"contact_id" uuid NOT NULL,
	"issue_date" date,
	"due_date" date,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"net_cents" bigint NOT NULL,
	"tax_cents" bigint NOT NULL,
	"gross_cents" bigint NOT NULL,
	"status" "billing_doc_status" DEFAULT 'entwurf' NOT NULL,
	"source" "billing_doc_source" DEFAULT 'nativ' NOT NULL,
	"pdf_document_id" uuid,
	"finalized_at" timestamp with time zone,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"object_id" uuid,
	"measure_code" text,
	"status" "case_status" DEFAULT 'anfrage' NOT NULL,
	"status_overridden" boolean DEFAULT false NOT NULL,
	"opened_at" date,
	"closed_at" date,
	"storage_path" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"contact_id" uuid,
	"object_id" uuid,
	"channel" "comm_channel" NOT NULL,
	"direction" "comm_direction" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject" text,
	"body" text,
	"author" text,
	"match_confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_persons" (
	"organisation_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text,
	CONSTRAINT "contact_persons_organisation_id_person_id_pk" PRIMARY KEY("organisation_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"display_name" text NOT NULL,
	"salutation" text,
	"first_name" text,
	"last_name" text,
	"organisation_name" text,
	"customer_number" text,
	"street" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"leitweg_id" text,
	"vat_id" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"object_id" uuid,
	"contact_id" uuid,
	"title" text NOT NULL,
	"doc_class" text,
	"storage" "document_storage" NOT NULL,
	"location" text NOT NULL,
	"mime_type" text,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_refs" (
	"source" text NOT NULL,
	"external_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_refs_source_external_type_external_id_pk" PRIMARY KEY("source","external_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "measure_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_roles" (
	"object_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" "object_role" NOT NULL,
	"valid_from" date,
	"valid_to" date,
	CONSTRAINT "object_roles_object_id_contact_id_role_pk" PRIMARY KEY("object_id","contact_id","role")
);
--> statement-breakpoint
CREATE TABLE "objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"street" text,
	"postal_code" text,
	"city" text,
	"country" text DEFAULT 'DE' NOT NULL,
	"usage" "object_usage" DEFAULT 'unbekannt' NOT NULL,
	"building_type" text,
	"construction_year" integer,
	"heated_area_m2" numeric(10, 2),
	"units" integer,
	"storage_path" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_pdf_document_id_documents_id_fk" FOREIGN KEY ("pdf_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_customer_id_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_measure_code_measure_types_code_fk" FOREIGN KEY ("measure_code") REFERENCES "public"."measure_types"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_organisation_id_contacts_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_person_id_contacts_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_roles" ADD CONSTRAINT "object_roles_object_id_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_roles" ADD CONSTRAINT "object_roles_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_documents_number_uq" ON "billing_documents" USING btree ("number");--> statement-breakpoint
CREATE INDEX "billing_documents_case_idx" ON "billing_documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "billing_documents_contact_idx" ON "billing_documents" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_number_uq" ON "cases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "cases_customer_idx" ON "cases" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "cases_object_idx" ON "cases" USING btree ("object_id");--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "communications_case_idx" ON "communications" USING btree ("case_id","occurred_at");--> statement-breakpoint
CREATE INDEX "communications_contact_idx" ON "communications" USING btree ("contact_id","occurred_at");--> statement-breakpoint
CREATE INDEX "communications_unassigned_idx" ON "communications" USING btree ("occurred_at") WHERE "communications"."case_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_channels_contact_kind_value_uq" ON "contact_channels" USING btree ("contact_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_channels_lookup_idx" ON "contact_channels" USING btree ("normalized_value");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_customer_number_uq" ON "contacts" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "contacts_display_name_idx" ON "contacts" USING btree (lower("display_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_location_uq" ON "documents" USING btree ("storage","location");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "events_entity_idx" ON "events" USING btree ("entity_type","entity_id","id");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","id");--> statement-breakpoint
CREATE INDEX "external_refs_entity_idx" ON "external_refs" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "objects_city_idx" ON "objects" USING btree ("city");