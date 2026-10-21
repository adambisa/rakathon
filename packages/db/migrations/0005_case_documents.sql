CREATE TABLE "app"."cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"processing_started_at" timestamp with time zone,
	"mapping_started_at" timestamp with time zone,
	"mapped_at" timestamp with time zone,
	"mapping_result_key" text,
	"review_started_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"export_started_at" timestamp with time zone,
	"exported_at" timestamp with time zone,
	"status" text GENERATED ALWAYS AS (case
    when exported_at is not null then 'exported'
    when export_started_at is not null then 'exporting'
    when approved_at is not null then 'approved'
    when review_started_at is not null then 'in_review'
    when mapped_at is not null then 'ready_for_review'
    when mapping_started_at is not null then 'mapping'
    when processing_started_at is not null then 'extracting'
    when submitted_at is not null then 'queued'
    else 'draft' end) STORED NOT NULL,
	CONSTRAINT "cases_name" CHECK (length("app"."cases"."name") between 1 and 255 and "app"."cases"."name" ~ '[^[:space:]]'),
	CONSTRAINT "cases_updated_order" CHECK ("app"."cases"."updated_at" is null or ("app"."cases"."created_at" is not null and "app"."cases"."updated_at" >= "app"."cases"."created_at")),
	CONSTRAINT "cases_submitted_order" CHECK ("app"."cases"."submitted_at" is null or ("app"."cases"."created_at" is not null and "app"."cases"."submitted_at" >= "app"."cases"."created_at")),
	CONSTRAINT "cases_processing_order" CHECK ("app"."cases"."processing_started_at" is null or ("app"."cases"."submitted_at" is not null and "app"."cases"."processing_started_at" >= "app"."cases"."submitted_at")),
	CONSTRAINT "cases_mapping_order" CHECK ("app"."cases"."mapping_started_at" is null or ("app"."cases"."processing_started_at" is not null and "app"."cases"."mapping_started_at" >= "app"."cases"."processing_started_at")),
	CONSTRAINT "cases_mapped_order" CHECK ("app"."cases"."mapped_at" is null or ("app"."cases"."mapping_started_at" is not null and "app"."cases"."mapped_at" >= "app"."cases"."mapping_started_at")),
	CONSTRAINT "cases_review_order" CHECK ("app"."cases"."review_started_at" is null or ("app"."cases"."mapped_at" is not null and "app"."cases"."review_started_at" >= "app"."cases"."mapped_at")),
	CONSTRAINT "cases_approval_order" CHECK ("app"."cases"."approved_at" is null or ("app"."cases"."review_started_at" is not null and "app"."cases"."approved_at" >= "app"."cases"."review_started_at")),
	CONSTRAINT "cases_export_start_order" CHECK ("app"."cases"."export_started_at" is null or ("app"."cases"."approved_at" is not null and "app"."cases"."export_started_at" >= "app"."cases"."approved_at")),
	CONSTRAINT "cases_exported_order" CHECK ("app"."cases"."exported_at" is null or ("app"."cases"."export_started_at" is not null and "app"."cases"."exported_at" >= "app"."cases"."export_started_at")),
	CONSTRAINT "cases_mapping_result_nonblank" CHECK ("app"."cases"."mapping_result_key" is null or "app"."cases"."mapping_result_key" ~ '[^[:space:]]'),
	CONSTRAINT "cases_mapped_result" CHECK ("app"."cases"."mapped_at" is null or "app"."cases"."mapping_result_key" is not null),
	CONSTRAINT "cases_approval_pair" CHECK (("app"."cases"."approved_at" is null) = ("app"."cases"."approved_by" is null)),
	CONSTRAINT "cases_approval_owner" CHECK ("app"."cases"."approved_by" is null or "app"."cases"."approved_by" = "app"."cases"."owner_id")
);
--> statement-breakpoint
CREATE TABLE "app"."documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"uploaded_by" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" bigint,
	"content_type" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"source_version_id" text,
	"uploaded_at" timestamp with time zone,
	"extraction_started_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"extraction_result_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text GENERATED ALWAYS AS (case
    when extracted_at is not null then 'extracted'
    when extraction_started_at is not null then 'extracting'
    when uploaded_at is not null then 'uploaded'
    else 'awaiting_upload' end) STORED NOT NULL,
	CONSTRAINT "documents_storage_identity" UNIQUE("storage_bucket","storage_key"),
	CONSTRAINT "documents_filename" CHECK (length("app"."documents"."filename") between 1 and 255 and "app"."documents"."filename" ~ '[^[:space:]]'),
	CONSTRAINT "documents_size" CHECK ("app"."documents"."size_bytes" is null or "app"."documents"."size_bytes" > 0),
	CONSTRAINT "documents_content_type" CHECK ("app"."documents"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/tiff')),
	CONSTRAINT "documents_storage_bucket" CHECK ("app"."documents"."storage_bucket" ~ '[^[:space:]]'),
	CONSTRAINT "documents_storage_key" CHECK ("app"."documents"."storage_key" ~ '[^[:space:]]'),
	CONSTRAINT "documents_uploaded_version" CHECK ("app"."documents"."uploaded_at" is null or "app"."documents"."source_version_id" is not null),
	CONSTRAINT "documents_source_version" CHECK ("app"."documents"."source_version_id" is null or "app"."documents"."source_version_id" ~ '[^[:space:]]'),
	CONSTRAINT "documents_extraction_result_nonblank" CHECK ("app"."documents"."extraction_result_key" is null or "app"."documents"."extraction_result_key" ~ '[^[:space:]]'),
	CONSTRAINT "documents_extracted_result" CHECK ("app"."documents"."extracted_at" is null or "app"."documents"."extraction_result_key" is not null),
	CONSTRAINT "documents_updated_order" CHECK ("app"."documents"."updated_at" is null or ("app"."documents"."created_at" is not null and "app"."documents"."updated_at" >= "app"."documents"."created_at")),
	CONSTRAINT "documents_uploaded_order" CHECK ("app"."documents"."uploaded_at" is null or ("app"."documents"."created_at" is not null and "app"."documents"."uploaded_at" >= "app"."documents"."created_at")),
	CONSTRAINT "documents_extraction_order" CHECK ("app"."documents"."extraction_started_at" is null or ("app"."documents"."uploaded_at" is not null and "app"."documents"."extraction_started_at" >= "app"."documents"."uploaded_at")),
	CONSTRAINT "documents_extracted_order" CHECK ("app"."documents"."extracted_at" is null or ("app"."documents"."extraction_started_at" is not null and "app"."documents"."extracted_at" >= "app"."documents"."extraction_started_at"))
);
--> statement-breakpoint
LOCK TABLE app.jobs IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM app.jobs) THEN
    RAISE EXCEPTION 'Clear legacy jobs before installing the case/document model';
  END IF;
END $$;
--> statement-breakpoint
DROP TABLE "app"."jobs";--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."cases" ADD CONSTRAINT "cases_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_owner_created" ON "app"."cases" USING btree ("owner_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "documents_case" ON "app"."documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "documents_uploader" ON "app"."documents" USING btree ("uploaded_by");
--> statement-breakpoint
-- Serialize document mutations with case lifecycle transitions on the parent row.
CREATE FUNCTION app.guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
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

  IF TG_OP <> 'DELETE' THEN
    IF NEW.extraction_started_at IS NOT NULL AND
       (parent.processing_started_at IS NULL OR NEW.extraction_started_at < parent.processing_started_at) THEN
      RAISE EXCEPTION 'Document extraction requires case processing to have started'
        USING ERRCODE = '23514', CONSTRAINT = 'documents_case_processing';
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
CREATE TRIGGER documents_guard BEFORE INSERT OR UPDATE OR DELETE ON app.documents
FOR EACH ROW EXECUTE FUNCTION app.guard_document();
--> statement-breakpoint
CREATE FUNCTION app.guard_case() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE milestone text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.submitted_at IS NOT NULL OR NEW.processing_started_at IS NOT NULL
       OR NEW.mapping_started_at IS NOT NULL OR NEW.mapped_at IS NOT NULL
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

  FOREACH milestone IN ARRAY ARRAY['submitted_at', 'processing_started_at', 'mapping_started_at',
    'mapped_at', 'review_started_at', 'approved_at', 'export_started_at', 'exported_at'] LOOP
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
--> statement-breakpoint
CREATE TRIGGER cases_guard BEFORE INSERT OR UPDATE OR DELETE ON app.cases
FOR EACH ROW EXECUTE FUNCTION app.guard_case();
