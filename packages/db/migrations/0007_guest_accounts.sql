-- Better Auth anonymous plugin: guest sessions are real reviewer rows flagged here.
-- Guests submit no address, so display_email falls back to the generated email.
ALTER TABLE "auth"."user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE FUNCTION auth.default_display_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_email IS NULL THEN NEW.display_email := NEW.email; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_display_email BEFORE INSERT ON auth."user"
FOR EACH ROW EXECUTE FUNCTION auth.default_display_email();
