-- Exports: the history/audit row of every export, the stored file of scheduled exports (kept for a limited time), and schedules.
-- Idempotent on purpose, like 0017..0019: the applied history of existing databases is unknown.
CREATE TABLE IF NOT EXISTS "export_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"dataset" varchar(40) NOT NULL,
	"format" varchar(8) NOT NULL,
	"frequency" varchar(10) NOT NULL,
	"hour_utc" integer DEFAULT 6 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" varchar(12),
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"schedule_id" uuid,
	"dataset" varchar(40) NOT NULL,
	"format" varchar(8) NOT NULL,
	"source" varchar(12) NOT NULL,
	"status" varchar(12) NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"file_name" varchar(255),
	"content_type" varchar(100),
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"content" bytea,
	"error" varchar(500),
	"download_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "export_schedules" ADD CONSTRAINT "export_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_schedules_user_idx" ON "export_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_schedules_due_idx" ON "export_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_jobs_user_idx" ON "export_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_jobs_schedule_idx" ON "export_jobs" USING btree ("schedule_id");
