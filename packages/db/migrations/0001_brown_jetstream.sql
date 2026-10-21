ALTER TABLE "app"."job_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "app"."job_events" CASCADE;--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP CONSTRAINT "jobs_attempt";--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP CONSTRAINT "jobs_revision";--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP COLUMN "document_key";--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP COLUMN "attempt";--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP COLUMN "revision";