CREATE TYPE "public"."e_invoice_format" AS ENUM('zugferd', 'xrechnung', 'keine');--> statement-breakpoint
CREATE TYPE "public"."incoming_invoice_status" AS ENUM('offen', 'geprueft', 'bezahlt', 'abgelehnt');--> statement-breakpoint
CREATE TYPE "public"."tax_category" AS ENUM('S', 'Z', 'E', 'AE', 'O');--> statement-breakpoint
CREATE TABLE "articles" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_code" text DEFAULT 'C62' NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"tax_category" "tax_category" DEFAULT 'S' NOT NULL,
	"tax_rate_percent" numeric(5, 2) DEFAULT '19' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_document_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"article_code" text,
	"name" text NOT NULL,
	"description" text,
	"quantity" numeric(14, 4) NOT NULL,
	"unit_code" text NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"tax_category" "tax_category" NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"line_net_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incoming_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"syntax" text NOT NULL,
	"type_code" text,
	"number" text NOT NULL,
	"issue_date" date,
	"due_date" date,
	"seller_name" text,
	"seller_vat_id" text,
	"buyer_reference" text,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"net_cents" bigint,
	"tax_cents" bigint,
	"gross_cents" bigint,
	"payable_cents" bigint,
	"iban" text,
	"status" "incoming_invoice_status" DEFAULT 'offen' NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "intro" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "closing" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "buyer_reference" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "order_reference" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "service_date" date;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "service_period_start" date;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "service_period_end" date;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "payment_terms_text" text;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "preceding_document_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "prepaid_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "e_invoice_format" "e_invoice_format" DEFAULT 'zugferd' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "seller_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "buyer_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "xml_document_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "validation" jsonb;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "reminder_level" integer;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_billing_document_id_billing_documents_id_fk" FOREIGN KEY ("billing_document_id") REFERENCES "public"."billing_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_invoices" ADD CONSTRAINT "incoming_invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_lines_position_uq" ON "billing_lines" USING btree ("billing_document_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "incoming_invoices_sha_uq" ON "incoming_invoices" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_xml_document_id_documents_id_fk" FOREIGN KEY ("xml_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;