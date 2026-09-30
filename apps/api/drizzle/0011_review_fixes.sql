ALTER TABLE "billing_documents" ADD COLUMN "prepaid_net_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "prepaid_tax_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "deductions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD COLUMN "exemption_reasons" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_documents_one_storno_uq" ON "billing_documents" USING btree ("preceding_document_id") WHERE "billing_documents"."type" = 'stornorechnung' and "billing_documents"."status" <> 'entwurf';