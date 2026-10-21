DELETE FROM "app"."jobs";--> statement-breakpoint
ALTER TABLE "app"."jobs" DROP CONSTRAINT "jobs_status";--> statement-breakpoint
ALTER TABLE "app"."jobs" ADD COLUMN "uploaded_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."jobs" ADD CONSTRAINT "jobs_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_uploaded_by" ON "app"."jobs" USING btree ("uploaded_by");--> statement-breakpoint
ALTER TABLE "app"."jobs" ADD CONSTRAINT "jobs_status" CHECK ("app"."jobs"."status" in ('awaiting_upload', 'created', 'extracting', 'extracted', 'mapping', 'done', 'failed'));