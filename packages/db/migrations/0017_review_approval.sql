ALTER TABLE "app"."case_reviews" ADD COLUMN "approved_revision" integer;--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD CONSTRAINT "case_reviews_case_id_approved_revision_review_revisions_case_id_revision_fk" FOREIGN KEY ("case_id","approved_revision") REFERENCES "app"."review_revisions"("case_id","revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD CONSTRAINT "review_approval_current" CHECK ("app"."case_reviews"."approved_revision" is null or "app"."case_reviews"."approved_revision" = "app"."case_reviews"."current_revision");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_review_head() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent app.cases%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Review history cannot be detached' USING ERRCODE = '23514', CONSTRAINT = 'review_head_retained';
  END IF;
  SELECT * INTO parent FROM app.cases WHERE id = NEW.case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE = '23503'; END IF;
  IF parent.review_started_at IS NULL OR parent.approved_at IS NOT NULL OR parent.export_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Review is not editable' USING ERRCODE = '23514', CONSTRAINT = 'review_head_editable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.current_revision = 1 AND NEW.approved_revision IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.case_id = OLD.case_id THEN
    IF NEW.current_revision = OLD.current_revision + 1 AND OLD.approved_revision IS NULL AND NEW.approved_revision IS NULL THEN RETURN NEW; END IF;
    IF NEW.current_revision = OLD.current_revision THEN
      IF OLD.approved_revision IS NULL AND NEW.approved_revision = NEW.current_revision THEN RETURN NEW; END IF;
      IF OLD.approved_revision IS NOT NULL AND NEW.approved_revision IS NULL THEN RETURN NEW; END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Invalid review revision/approval transition' USING ERRCODE = '23514', CONSTRAINT = 'review_head_sequence';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_legacy_review_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_at IS NULL AND NEW.approved_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM app.case_reviews WHERE case_id = NEW.id AND (approved_revision IS NULL OR approved_revision <> current_revision)
  ) THEN
    RAISE EXCEPTION 'Saved review requires revision-based approval' USING ERRCODE = '23514', CONSTRAINT = 'cases_review_approval_required';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION app.reopen_review_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.approved_at IS NOT NULL AND NEW.approved_at IS NULL THEN
    UPDATE app.case_reviews SET approved_revision = NULL WHERE case_id = NEW.id AND approved_revision IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cases_review_reopen AFTER UPDATE OF approved_at ON app.cases
FOR EACH ROW EXECUTE FUNCTION app.reopen_review_pointer();
