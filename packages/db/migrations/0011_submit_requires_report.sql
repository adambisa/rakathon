-- A sector map alone maps nothing: the report is the one document a case cannot be submitted without.
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

  IF OLD.approved_at IS NOT NULL AND
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'export_started_at', 'exported_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'export_started_at', 'exported_at']) THEN
    RAISE EXCEPTION 'Approved case content is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_approved_immutable';
  END IF;

  FOREACH milestone IN ARRAY ARRAY['submitted_at', 'mapped_at', 'review_started_at', 'approved_at', 'export_started_at', 'exported_at'] LOOP
    IF to_jsonb(OLD)->>milestone IS NOT NULL AND
       to_jsonb(NEW)->milestone IS DISTINCT FROM to_jsonb(OLD)->milestone THEN
      RAISE EXCEPTION 'Case milestones cannot be rewritten'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_milestones_immutable';
    END IF;
  END LOOP;

  IF OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id)
       OR EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id AND
         (uploaded_at IS NULL OR uploaded_at > NEW.submitted_at)) THEN
      RAISE EXCEPTION 'Submission requires at least one document and all uploads complete'
        USING ERRCODE = '23514', CONSTRAINT = 'cases_documents_uploaded';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id AND kind = 'report') THEN
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
