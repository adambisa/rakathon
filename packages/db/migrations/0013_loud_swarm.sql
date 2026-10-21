ALTER TABLE "app"."cases" ADD COLUMN "redcap_record_id" text;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD COLUMN "export_unconfirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_redcap_record" UNIQUE("redcap_record_id");--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_redcap_id_nonblank" CHECK ("app"."cases"."redcap_record_id" is null or "app"."cases"."redcap_record_id" ~ '[^[:space:]]');--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_export_receipt" CHECK (("app"."cases"."exported_at" is null) = ("app"."cases"."redcap_record_id" is null));--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_export_unconfirmed" CHECK (not "app"."cases"."export_unconfirmed" or ("app"."cases"."export_started_at" is not null and "app"."cases"."exported_at" is null));
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
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'approved_at', 'approved_by', 'export_started_at', 'exported_at', 'redcap_record_id', 'export_unconfirmed'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'approved_at', 'approved_by', 'export_started_at', 'exported_at', 'redcap_record_id', 'export_unconfirmed']) THEN
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
