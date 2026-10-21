ALTER TABLE "app"."case_reviews" ADD COLUMN "blocking_issue_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD COLUMN "unresolved_field_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD COLUMN "unresolved_mark_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."case_reviews" ADD COLUMN "unconfirmed_section_count" integer DEFAULT 0 NOT NULL;