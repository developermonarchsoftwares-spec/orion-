-- Privacy compliance: consent ledger, data-subject requests, and a deletion marker on users.
-- Idempotent on purpose, like 0017..0022: the applied history of existing databases is unknown.
CREATE TABLE IF NOT EXISTS "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"purpose" varchar(32) NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" varchar(16) NOT NULL,
	"source" varchar(16) DEFAULT 'settings' NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email_hash" varchar(64) NOT NULL,
	"type" varchar(8) NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"note" varchar(300),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"execute_after" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_records_user_purpose_idx" ON "consent_records" ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_user_idx" ON "privacy_requests" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_status_idx" ON "privacy_requests" ("status","execute_after");
