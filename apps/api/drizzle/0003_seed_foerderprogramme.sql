-- Förderprogramme und Fristenregeln (Stand der Richtlinien: BEG EM 21.12.2023 und 17.07.2026,
-- BEG WG/NWG 17.07.2026). Regeln sind Daten: vor produktiver Nutzung gegen aktuelle
-- Merkblätter prüfen; Anpassung über die API (/deadline-rules), nicht per Migration.
INSERT INTO funding_programs (code, name, approval_period_months) VALUES
  ('beg_em_bafa', 'BEG EM – Zuschuss BAFA (Hülle, Anlagentechnik, Heizungsoptimierung)', 36),
  ('beg_em_kfw_heizung', 'BEG EM – Heizungsförderung KfW', NULL),
  ('beg_wg', 'BEG WG – Effizienzhaus (systemisch)', 48),
  ('beg_nwg', 'BEG NWG – Effizienzgebäude (systemisch)', 48),
  ('ebw', 'Energieberatung für Wohngebäude (iSFP)', NULL),
  ('ebn', 'Energieberatung für Nichtwohngebäude, Anlagen und Systeme', NULL),
  ('sonstige', 'Sonstige Förderung', NULL)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO deadline_rules (id, program_code, anchor, offset_months, offset_days, lead_days, done_when, title, description, source_note) VALUES
  ('6f0f6a3e-0001-4000-8000-000000000001', 'beg_em_bafa', 'approval_valid_until', 0, 0, 90, 'measure_completed_at',
   'Ende Bewilligungszeitraum – Maßnahme abschließen',
   'Die Maßnahme muss innerhalb des Bewilligungszeitraums umgesetzt sein.',
   'BEG EM: Bewilligungszeitraum 36 Monate ab Zusage (Richtlinie 21.12.2023 und 17.07.2026)'),
  ('6f0f6a3e-0001-4000-8000-000000000002', 'beg_em_bafa', 'approval_valid_until', 6, 0, 60, 'proof_submitted_at',
   'Verwendungsnachweis einreichen',
   'Spätestens 6 Monate nach Ende des Bewilligungszeitraums, sonst Anspruchsverlust.',
   'BEG EM: Verwendungsnachweis spätestens 6 Monate nach Ablauf des Bewilligungszeitraums'),
  ('6f0f6a3e-0001-4000-8000-000000000003', 'beg_em_bafa', 'tpn_created_at', 2, 0, 14, 'proof_submitted_at',
   'TPN-ID läuft ab',
   'Die TPN-ID ist 2 Monate gültig; innerhalb dieser Zeit muss der Verwendungsnachweis gestellt werden.',
   'BEG EM: TPN-ID 2 Monate gültig'),
  ('6f0f6a3e-0001-4000-8000-000000000004', 'beg_wg', 'approval_valid_until', 0, 0, 90, 'measure_completed_at',
   'Ende Bewilligungszeitraum – Vorhaben abschließen', NULL,
   'BEG WG: Bewilligungszeitraum 48 Monate (Richtlinie 17.07.2026)'),
  ('6f0f6a3e-0001-4000-8000-000000000005', 'beg_wg', 'approval_valid_until', 6, 0, 60, 'proof_submitted_at',
   'Verwendungsnachweis einreichen', NULL,
   'BEG WG: Verwendungsnachweis 6 Monate nach Ende des Bewilligungszeitraums'),
  ('6f0f6a3e-0001-4000-8000-000000000006', 'beg_nwg', 'approval_valid_until', 0, 0, 90, 'measure_completed_at',
   'Ende Bewilligungszeitraum – Vorhaben abschließen', NULL,
   'BEG NWG: Bewilligungszeitraum 48 Monate (Richtlinie 17.07.2026)'),
  ('6f0f6a3e-0001-4000-8000-000000000007', 'beg_nwg', 'approval_valid_until', 6, 0, 60, 'proof_submitted_at',
   'Verwendungsnachweis einreichen', NULL,
   'BEG NWG: Verwendungsnachweis 6 Monate nach Ende des Bewilligungszeitraums'),
  ('6f0f6a3e-0001-4000-8000-000000000008', 'beg_em_kfw_heizung', 'bza_created_at', 6, 0, 30, 'applied_at',
   'Bestätigung zum Antrag läuft ab',
   'Die Bestätigung zum Antrag ist 6 Monate ab Erstellung gültig.',
   'KfW: BzA 6 Monate ab Erstellung gültig'),
  ('6f0f6a3e-0001-4000-8000-000000000009', '*', 'isfp_date', 180, 0, 180, NULL,
   'iSFP wird älter als 15 Jahre – iSFP-Bonus entfällt', NULL,
   'BEG EM: iSFP-Bonus nur mit iSFP, der höchstens 15 Jahre alt ist')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER funding_cases_touch BEFORE UPDATE ON funding_cases FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER deadline_rules_touch BEFORE UPDATE ON deadline_rules FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER deadlines_touch BEFORE UPDATE ON deadlines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER webhook_subscriptions_touch BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
