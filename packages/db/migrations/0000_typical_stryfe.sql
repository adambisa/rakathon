CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TABLE "app"."job_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"previous_status" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_events_idempotency" UNIQUE("job_id","event_id"),
	CONSTRAINT "job_events_status" CHECK ("app"."job_events"."status" in ('created', 'extracting', 'extracted', 'mapping', 'done', 'failed')),
	CONSTRAINT "job_events_previous_status" CHECK ("app"."job_events"."previous_status" in ('created', 'extracting', 'extracted', 'mapping', 'done', 'failed')),
	CONSTRAINT "job_events_attempt" CHECK ("app"."job_events"."attempt" > 0)
);
--> statement-breakpoint
CREATE TABLE "app"."jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document_key" text,
	"error" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "jobs_status" CHECK ("app"."jobs"."status" in ('created', 'extracting', 'extracted', 'mapping', 'done', 'failed')),
	CONSTRAINT "jobs_filename" CHECK (length(trim("app"."jobs"."filename")) > 0),
	CONSTRAINT "jobs_attempt" CHECK ("app"."jobs"."attempt" > 0),
	CONSTRAINT "jobs_revision" CHECK ("app"."jobs"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "app"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_events_history" ON "app"."job_events" USING btree ("job_id","created_at","id");--> statement-breakpoint
CREATE INDEX "jobs_created_id" ON "app"."jobs" USING btree ("created_at" DESC NULLS LAST,"id" DESC NULLS LAST);
--> statement-breakpoint
REVOKE UPDATE ON app.job_events FROM prostapaper_app;

--> statement-breakpoint
GRANT UPDATE ON app.jobs TO prostapaper_app;
