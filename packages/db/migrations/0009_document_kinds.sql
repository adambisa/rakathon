-- A case carries one pathology report and one hand-drawn schema, so document kinds are the
-- membership rule: the unique pair (case_id, kind) allows one of each, the trigger refuses a third
-- document outright, and extraction classifies each upload instead of asking the uploader.
ALTER TABLE "app"."documents" ADD COLUMN "kind" text;--> statement-breakpoint
-- Existing extractions predate classification; the earlier document of a case becomes its report.
-- Cases that collected more than two documents under the old UI keep them, their extras unclassified:
-- migrations run at API startup, so refusing to install here would crash-loop the service instead.
ALTER TABLE "app"."documents" DISABLE TRIGGER documents_guard;--> statement-breakpoint
UPDATE "app"."documents" AS d SET kind = ranked.kind FROM (
  SELECT id, CASE row_number() OVER (PARTITION BY case_id ORDER BY extracted_at, created_at, id)
    WHEN 1 THEN 'report' WHEN 2 THEN 'schema' END AS kind
  FROM app.documents WHERE extracted_at IS NOT NULL
) AS ranked WHERE d.id = ranked.id AND ranked.kind IS NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."documents" ENABLE TRIGGER documents_guard;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_case_kind" UNIQUE("case_id","kind");--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_kind" CHECK ("app"."documents"."kind" is null or "app"."documents"."kind" in ('report', 'schema'));--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_kind_extracted" CHECK ("app"."documents"."kind" is null or "app"."documents"."extracted_at" is not null);--> statement-breakpoint
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

  IF TG_OP = 'INSERT' AND
     (SELECT count(*) FROM app.documents WHERE case_id = NEW.case_id) >= 2 THEN
    RAISE EXCEPTION 'A case holds at most two documents: the report and the schema'
      USING ERRCODE = '23514', CONSTRAINT = 'documents_case_limit';
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
    IF OLD.kind IS NOT NULL AND NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION 'Document kind is immutable once classified'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_kind_immutable';
    END IF;
    IF OLD.extracted_at IS NOT NULL AND NEW.extraction_result_key IS DISTINCT FROM OLD.extraction_result_key THEN
      RAISE EXCEPTION 'Completed extraction result is immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_result_immutable';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
