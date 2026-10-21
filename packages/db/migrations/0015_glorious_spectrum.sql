CREATE TABLE "app"."case_members" (
	"case_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_members_case_user" UNIQUE("case_id","user_id"),
	CONSTRAINT "case_members_role" CHECK ("app"."case_members"."role" in ('reviewer', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "app"."cases" DROP CONSTRAINT "cases_approval_owner";--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "app"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."case_members" ADD CONSTRAINT "case_members_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_members_user" ON "app"."case_members" USING btree ("user_id","case_id");