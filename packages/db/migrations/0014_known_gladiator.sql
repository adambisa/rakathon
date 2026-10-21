CREATE TABLE "app"."case_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"attempt_id" uuid,
	"kind" text NOT NULL,
	"payload_hash" text,
	"redcap_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_audit_kind" CHECK ("app"."case_audit_events"."kind" in ('approved', 'reopened', 'export_started', 'export_prepared', 'export_confirmed', 'exported', 'export_preflight_failed', 'export_unconfirmed')),
	CONSTRAINT "case_audit_hash" CHECK ("app"."case_audit_events"."payload_hash" is null or "app"."case_audit_events"."payload_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "app"."cases" ADD COLUMN "export_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD COLUMN "export_payload_hash" text;--> statement-breakpoint
ALTER TABLE "app"."case_audit_events" ADD CONSTRAINT "case_audit_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_audit_events" ADD CONSTRAINT "case_audit_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_audit_case" ON "app"."case_audit_events" USING btree ("case_id","created_at");--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_export_hash" CHECK ("app"."cases"."export_payload_hash" is null or "app"."cases"."export_payload_hash" ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE milestone text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.submitted_at IS NOT NULL OR NEW.mapping_started_at IS NOT NULL OR NEW.mapped_at IS NOT NULL
       OR NEW.review_started_at IS NOT NULL OR NEW.approved_at IS NOT NULL
       OR NEW.export_started_at IS NOT NULL OR NEW.exported_at IS NOT NULL THEN
      RAISE EXCEPTION 'Cases must be created as drafts'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_create_draft';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Submitted cases cannot be deleted'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_submitted_delete';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Case identity and ownership are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_identity_immutable';
  END IF;

  IF OLD.exported_at IS NOT NULL AND
     (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'Exported cases are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_exported_immutable';
  END IF;

  IF OLD.approved_at IS NOT NULL AND
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'approved_at', 'approved_by', 'export_started_at', 'exported_at', 'redcap_record_id', 'export_unconfirmed', 'export_attempt_id', 'export_payload_hash'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'approved_at', 'approved_by', 'export_started_at', 'exported_at', 'redcap_record_id', 'export_unconfirmed', 'export_attempt_id', 'export_payload_hash']) THEN
    RAISE EXCEPTION 'Approved case content is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_approved_immutable';
  END IF;

  FOREACH milestone IN ARRAY ARRAY['submitted_at', 'mapped_at', 'review_started_at', 'approved_at', 'export_started_at', 'exported_at'] LOOP
    -- Reopening clears approval only before export starts. A failed preflight may
    -- release its export claim; uncertain imports must first be reconciled.
    IF milestone = 'approved_at' AND OLD.export_started_at IS NULL
       AND NEW.approved_at IS NULL AND NEW.approved_by IS NULL THEN CONTINUE; END IF;
    IF milestone = 'export_started_at' AND OLD.exported_at IS NULL
       AND NOT OLD.export_unconfirmed AND NEW.export_started_at IS NULL THEN CONTINUE; END IF;
    IF to_jsonb(OLD)->>milestone IS NOT NULL AND
       to_jsonb(NEW)->milestone IS DISTINCT FROM to_jsonb(OLD)->milestone THEN
      RAISE EXCEPTION 'Case milestones cannot be rewritten'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_milestones_immutable';
    END IF;
  END LOOP;

  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS NOT NULL
     AND NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
    RAISE EXCEPTION 'Approval identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_approval_immutable';
  END IF;

  IF OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id)
       OR EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id AND
         (uploaded_at IS NULL OR uploaded_at > NEW.submitted_at)) THEN
      RAISE EXCEPTION 'Submission requires at least one document and all uploads complete'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_documents_uploaded';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id AND kind = 'text_description') THEN
      RAISE EXCEPTION 'Submission requires the report'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_report_uploaded';
    END IF;
  END IF;

  IF NEW.mapping_started_at IS DISTINCT FROM OLD.mapping_started_at AND NEW.mapping_started_at IS NOT NULL AND
     EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id AND
       (extracted_at IS NULL OR extracted_at > NEW.mapping_started_at)) THEN
    RAISE EXCEPTION 'Mapping requires every document to be extracted'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_documents_extracted';
  END IF;

  IF OLD.mapped_at IS NOT NULL AND
     (NEW.mapping_started_at IS DISTINCT FROM OLD.mapping_started_at
      OR NEW.mapping_result_key IS DISTINCT FROM OLD.mapping_result_key) THEN
    RAISE EXCEPTION 'Completed mapping result is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_result_immutable';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Preserve the approval that exists when audit tracking is introduced.
INSERT INTO app.case_audit_events (case_id, actor_id, kind, created_at)
SELECT id, approved_by, 'approved', approved_at FROM app.cases WHERE approved_at IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION app.audit_case_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_kind text; use_old boolean := false;
BEGIN
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL THEN event_kind := 'approved';
  ELSIF OLD.approved_at IS NOT NULL AND NEW.approved_at IS NULL THEN event_kind := 'reopened';
  ELSIF OLD.export_started_at IS NULL AND NEW.export_started_at IS NOT NULL THEN event_kind := 'export_started';
  ELSIF OLD.export_started_at IS NOT NULL AND NEW.export_started_at IS NULL THEN event_kind := 'export_preflight_failed'; use_old := true;
  ELSIF OLD.exported_at IS NULL AND NEW.exported_at IS NOT NULL THEN event_kind := 'exported';
  ELSIF NOT OLD.export_unconfirmed AND NEW.export_unconfirmed THEN event_kind := 'export_unconfirmed';
  ELSIF NEW.export_payload_hash IS NOT NULL AND NEW.export_payload_hash IS DISTINCT FROM OLD.export_payload_hash THEN event_kind := 'export_prepared';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO app.case_audit_events (case_id, actor_id, attempt_id, kind, payload_hash, redcap_record_id)
  VALUES (NEW.id, COALESCE(NULLIF(current_setting('app.actor_id', true), ''), NEW.owner_id),
    CASE WHEN use_old THEN OLD.export_attempt_id ELSE NEW.export_attempt_id END,
    event_kind, CASE WHEN use_old THEN OLD.export_payload_hash ELSE NEW.export_payload_hash END, NEW.redcap_record_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cases_audit AFTER UPDATE ON app.cases FOR EACH ROW EXECUTE FUNCTION app.audit_case_transition();
--> statement-breakpoint
CREATE FUNCTION app.guard_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Case audit events are append-only'
    USING ERRCODE = '23514', CONSTRAINT = 'case_audit_append_only';
END $$;
--> statement-breakpoint
CREATE TRIGGER case_audit_guard BEFORE UPDATE OR DELETE ON app.case_audit_events
FOR EACH ROW EXECUTE FUNCTION app.guard_case_audit();
