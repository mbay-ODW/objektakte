-- GoBD: Festgeschriebene eigene Belege sind unveränderlich. Erlaubt sind nur der Versandvermerk
-- und die Statusfolge festgeschrieben → versendet → storniert. Korrekturen erfolgen per Storno.
CREATE OR REPLACE FUNCTION billing_reject_if_finalized() RETURNS trigger AS $$
DECLARE
  allowed text[] := ARRAY['status', 'sent_at', 'sent_via', 'updated_at'];
BEGIN
  IF OLD.source <> 'nativ' OR OLD.finalized_at IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Beleg % ist festgeschrieben und darf nicht gelöscht werden', OLD.number;
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Beleg % ist festgeschrieben; Änderungen nur per Storno', OLD.number;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'festgeschrieben' AND NEW.status IN ('versendet', 'storniert'))
    OR (OLD.status = 'versendet' AND NEW.status = 'storniert')
  ) THEN
    RAISE EXCEPTION 'Unzulässiger Statuswechsel % → % für Beleg %', OLD.status, NEW.status, OLD.number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER billing_documents_immutable BEFORE UPDATE OR DELETE ON billing_documents
  FOR EACH ROW EXECUTE FUNCTION billing_reject_if_finalized();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION billing_lines_reject_if_finalized() RETURNS trigger AS $$
DECLARE
  doc_id uuid;
  fin timestamptz;
  src billing_doc_source;
BEGIN
  IF TG_OP = 'DELETE' THEN doc_id := OLD.billing_document_id; ELSE doc_id := NEW.billing_document_id; END IF;
  SELECT finalized_at, source INTO fin, src FROM billing_documents WHERE id = doc_id;
  IF fin IS NOT NULL AND src = 'nativ' THEN
    RAISE EXCEPTION 'Positionen festgeschriebener Belege sind unveränderlich';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER billing_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON billing_lines
  FOR EACH ROW EXECUTE FUNCTION billing_lines_reject_if_finalized();
--> statement-breakpoint
CREATE TRIGGER articles_touch BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER incoming_invoices_touch BEFORE UPDATE ON incoming_invoices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
