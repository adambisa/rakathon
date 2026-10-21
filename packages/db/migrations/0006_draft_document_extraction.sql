-- Documents are extracted as soon as each upload arrives, while the case is still a draft.
-- Case submission stays the gate for case-level processing, and the case-level extraction
-- stage it used to gate no longer exists.
ALTER TABLE "app"."cases" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "app"."cases" DROP CONSTRAINT "cases_processing_order";--> statement-breakpoint
ALTER TABLE "app"."cases" DROP CONSTRAINT "cases_mapping_order";--> statement-breakpoint
ALTER TABLE "app"."cases" DROP COLUMN "processing_started_at";--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_mapping_order" CHECK ("app"."cases"."mapping_started_at" is null or ("app"."cases"."submitted_at" is not null and "app"."cases"."mapping_started_at" >= "app"."cases"."submitted_at"));--> statement-breakpoint
ALTER TABLE "app"."cases" ADD COLUMN "status" text GENERATED ALWAYS AS (case
    when exported_at is not null then 'exported'
    when export_started_at is not null then 'exporting'
    when approved_at is not null then 'approved'
    when review_started_at is not null then 'in_review'
    when mapped_at is not null then 'ready_for_review'
    when mapping_started_at is not null then 'mapping'
    when submitted_at is not null then 'queued'
    else 'draft' end) STORED NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent app.cases%ROWTYPE;
  parent_id uuid;
  milestone text;
BEGIN
  IF TG_OP = 'DELETE' THEN parent_id := OLD.case_id;
  ELSE parent_id := NEW.case_id; END IF;

  IF TG_OP = 'UPDATE' AND
     (NEW.id IS DISTINCT FROM OLD.id OR NEW.case_id IS DISTINCT FROM OLD.case_id
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'Document identity and attribution are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'documents_identity_immutable';
  END IF;

  SELECT * INTO parent FROM app.cases WHERE id = parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document case does not exist' USING ERRCODE = '23503';
  END IF;

  IF parent.approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Approved case documents are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'documents_approved_immutable';
  END IF;

  IF parent.submitted_at IS NOT NULL THEN
    IF TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'Submitted case document membership is frozen'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_membership_frozen';
    END IF;
    IF ROW(NEW.filename, NEW.size_bytes, NEW.content_type, NEW.storage_bucket, NEW.storage_key,
           NEW.source_version_id, NEW.uploaded_at)
       IS DISTINCT FROM
       ROW(OLD.filename, OLD.size_bytes, OLD.content_type, OLD.storage_bucket, OLD.storage_key,
           OLD.source_version_id, OLD.uploaded_at) THEN
      RAISE EXCEPTION 'Submitted case source documents are immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_source_frozen';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH milestone IN ARRAY ARRAY['uploaded_at', 'extraction_started_at', 'extracted_at'] LOOP
      IF to_jsonb(OLD)->>milestone IS NOT NULL AND
         to_jsonb(NEW)->milestone IS DISTINCT FROM to_jsonb(OLD)->milestone THEN
        RAISE EXCEPTION 'Document milestones cannot be rewritten'
          USING ERRCODE = '23514', CONSTRAINT = 'documents_milestones_immutable';
      END IF;
    END LOOP;
    IF OLD.source_version_id IS NOT NULL AND NEW.source_version_id IS DISTINCT FROM OLD.source_version_id THEN
      RAISE EXCEPTION 'Uploaded source version is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_version_immutable';
    END IF;
    IF OLD.extracted_at IS NOT NULL AND NEW.extraction_result_key IS DISTINCT FROM OLD.extraction_result_key THEN
      RAISE EXCEPTION 'Completed extraction result is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_result_immutable';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
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

  -- Export is operational metadata; everything describing approved content stays fixed.
  IF OLD.approved_at IS NOT NULL AND
     (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'export_started_at', 'exported_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'export_started_at', 'exported_at']) THEN
    RAISE EXCEPTION 'Approved case content is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_approved_immutable';
  END IF;

  FOREACH milestone IN ARRAY ARRAY['submitted_at', 'mapping_started_at', 'mapped_at', 'review_started_at', 'approved_at', 'export_started_at', 'exported_at'] LOOP
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
  END IF;

  IF OLD.mapping_started_at IS NULL AND NEW.mapping_started_at IS NOT NULL AND
     EXISTS (SELECT 1 FROM app.documents WHERE case_id = NEW.id AND
       (extracted_at IS NULL OR extracted_at > NEW.mapping_started_at)) THEN
    RAISE EXCEPTION 'Mapping requires every document to be extracted'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_documents_extracted';
  END IF;

  IF OLD.mapped_at IS NOT NULL AND NEW.mapping_result_key IS DISTINCT FROM OLD.mapping_result_key THEN
    RAISE EXCEPTION 'Completed mapping result is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_result_immutable';
  END IF;
  RETURN NEW;
END $$;
