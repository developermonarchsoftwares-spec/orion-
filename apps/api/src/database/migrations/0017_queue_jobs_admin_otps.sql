-- queue_jobs and admin_otps are defined in the Drizzle schema (and present in the 0004+ snapshots) but no earlier migration created them.
-- Idempotent on purpose: the applied history of existing databases is unknown, and a database that already has either table
-- (created out of band, e.g. with `drizzle-kit push`) is left untouched.
CREATE TABLE IF NOT EXISTS "queue_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue_name" varchar(100) NOT NULL,
	"job_name" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'WAITING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"result" jsonb,
	"locked_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"otp" varchar(255) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_queue_jobs_queue_status" ON "queue_jobs" USING btree ("queue_name","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_queue_jobs_created_at" ON "queue_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_otps_email" ON "admin_otps" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_otps_expires_at" ON "admin_otps" USING btree ("expires_at");
