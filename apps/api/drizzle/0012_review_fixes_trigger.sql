-- Positionen dürfen auch nicht aus einem festgeschriebenen Beleg „umgehängt“ werden (OLD prüfen).
CREATE OR REPLACE FUNCTION billing_lines_reject_if_finalized() RETURNS trigger AS $$
DECLARE
  fin timestamptz;
  src billing_doc_source;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT finalized_at, source INTO fin, src FROM billing_documents WHERE id = OLD.billing_document_id;
    IF fin IS NOT NULL AND src = 'nativ' THEN
      RAISE EXCEPTION 'Positionen festgeschriebener Belege sind unveränderlich';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT finalized_at, source INTO fin, src FROM billing_documents WHERE id = NEW.billing_document_id;
    IF fin IS NOT NULL AND src = 'nativ' THEN
      RAISE EXCEPTION 'Positionen festgeschriebener Belege sind unveränderlich';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Transaktions-ID je Ereignis: Webhooks/Feeds liefern nur Ereignisse abgeschlossener
-- Transaktionen aus, damit spät committende Transaktionen nicht übersprungen werden.
ALTER TABLE events ADD COLUMN tx_id xid8 NOT NULL DEFAULT pg_current_xact_id();
--> statement-breakpoint
CREATE INDEX events_tx_idx ON events (tx_id);
