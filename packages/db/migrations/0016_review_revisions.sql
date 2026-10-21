CREATE TABLE "app"."case_reviews" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"current_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."review_revisions" (
	"case_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"artifact_key" text NOT NULL,
	"artifact_version_id" text NOT NULL,
	"artifact_hash" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_revisions_case_id_revision_pk" PRIMARY KEY("case_id","revision"),
	CONSTRAINT "review_revisions_request" UNIQUE("case_id","request_id"),
	CONSTRAINT "review_revisions_artifact" UNIQUE("artifact_key"),
	CONSTRAINT "review_revision_positive" CHECK ("app"."review_revisions"."revision" > 0),
	CONSTRAINT "review_request_hash" CHECK ("app"."review_revisions"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "review_artifact_hash" CHECK ("app"."review_revisions"."artifact_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "review_artifact_key" CHECK ("app"."review_revisions"."artifact_key" ~ '[^[:space:]]'),
	CONSTRAINT "review_artifact_version" CHECK ("app"."review_revisions"."artifact_version_id" ~ '[^[:space:]]' and "app"."review_revisions"."artifact_version_id" <> 'null')
);
--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD CONSTRAINT "case_reviews_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD CONSTRAINT "case_reviews_case_id_current_revision_review_revisions_case_id_revision_fk" FOREIGN KEY ("case_id","current_revision") REFERENCES "app"."review_revisions"("case_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review_revisions" ADD CONSTRAINT "review_revisions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."review_revisions" ADD CONSTRAINT "review_revisions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION app.guard_review_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent app.cases%ROWTYPE; head integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Review revisions are append-only'
      USING ERRCODE = '23514', CONSTRAINT = 'review_revisions_append_only';
  END IF;
  SELECT * INTO parent FROM app.cases WHERE id = NEW.case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE = '23503'; END IF;
  IF parent.review_started_at IS NULL OR parent.approved_at IS NOT NULL
     OR parent.export_started_at IS NOT NULL OR parent.mapping_result_key IS NULL THEN
    RAISE EXCEPTION 'Review is not editable'
      USING ERRCODE = '23514', CONSTRAINT = 'review_revision_editable';
  END IF;
  IF NEW.actor_id IS DISTINCT FROM parent.owner_id AND NOT EXISTS (
    SELECT 1 FROM app.case_members
    WHERE case_id = NEW.case_id AND user_id = NEW.actor_id AND role = 'reviewer'
  ) THEN
    RAISE EXCEPTION 'Review actor must own the case or have reviewer access'
      USING ERRCODE = '23514', CONSTRAINT = 'review_revision_access';
  END IF;
  SELECT current_revision INTO head FROM app.case_reviews WHERE case_id = NEW.case_id;
  IF NEW.revision <> COALESCE(head, 0) + 1 THEN
    RAISE EXCEPTION 'Review revisions must be sequential'
      USING ERRCODE = '23514', CONSTRAINT = 'review_revision_sequence';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_revisions_guard BEFORE INSERT OR UPDATE OR DELETE ON app.review_revisions
FOR EACH ROW EXECUTE FUNCTION app.guard_review_revision();
--> statement-breakpoint
CREATE FUNCTION app.guard_review_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent app.cases%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Review history cannot be detached'
      USING ERRCODE = '23514', CONSTRAINT = 'review_head_retained';
  END IF;
  SELECT * INTO parent FROM app.cases WHERE id = NEW.case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE = '23503'; END IF;
  IF parent.review_started_at IS NULL OR parent.approved_at IS NOT NULL OR parent.export_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Review is not editable'
      USING ERRCODE = '23514', CONSTRAINT = 'review_head_editable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_revision <> 1 THEN
      RAISE EXCEPTION 'Review must start at revision one'
        USING ERRCODE = '23514', CONSTRAINT = 'review_head_sequence';
    END IF;
  ELSIF NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Review pointer must advance by one on the same case'
      USING ERRCODE = '23514', CONSTRAINT = 'review_head_sequence';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER case_reviews_guard BEFORE INSERT OR UPDATE OR DELETE ON app.case_reviews
FOR EACH ROW EXECUTE FUNCTION app.guard_review_head();
--> statement-breakpoint
-- Until revision approval lands, never let the legacy path approve/export an unreviewed mapping over saved corrections.
CREATE FUNCTION app.guard_legacy_review_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM app.case_reviews WHERE case_id = NEW.id) THEN
    RAISE EXCEPTION 'Saved review requires revision-based approval'
      USING ERRCODE = '23514', CONSTRAINT = 'cases_review_approval_required';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cases_review_approval_guard BEFORE UPDATE OF approved_at ON app.cases
FOR EACH ROW EXECUTE FUNCTION app.guard_legacy_review_approval();
