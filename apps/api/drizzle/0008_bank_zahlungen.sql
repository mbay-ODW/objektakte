CREATE TYPE "public"."allocation_source" AS ENUM('automatisch', 'manuell');--> statement-breakpoint
CREATE TYPE "public"."bank_tx_status" AS ENUM('offen', 'zugeordnet', 'teilweise', 'ignoriert');--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account" text NOT NULL,
	"booking_date" date NOT NULL,
	"value_date" date,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"counterparty_name" text,
	"counterparty_iban" text,
	"purpose" text,
	"reference" text,
	"dedupe_key" text NOT NULL,
	"status" "bank_tx_status" DEFAULT 'offen' NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"billing_document_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"source" "allocation_source" NOT NULL,
	"confidence" numeric(4, 3),
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_billing_document_id_billing_documents_id_fk" FOREIGN KEY ("billing_document_id") REFERENCES "public"."billing_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_dedupe_uq" ON "bank_transactions" USING btree ("account","dedupe_key");--> statement-breakpoint
CREATE INDEX "bank_transactions_status_idx" ON "bank_transactions" USING btree ("status","booking_date");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_uq" ON "payment_allocations" USING btree ("transaction_id","billing_document_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_doc_idx" ON "payment_allocations" USING btree ("billing_document_id");