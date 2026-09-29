-- Ereignisprotokoll ist append-only: nachträgliche Änderungen oder Löschungen sind unzulässig.
CREATE OR REPLACE FUNCTION events_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events ist append-only (% nicht erlaubt)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER events_no_update BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_reject_mutation();
--> statement-breakpoint
-- updated_at automatisch pflegen
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER objects_touch BEFORE UPDATE ON objects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER cases_touch BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER billing_documents_touch BEFORE UPDATE ON billing_documents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
