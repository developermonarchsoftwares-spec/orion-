-- Third-party integrations: webhook / CRM connections, their delivery log (retries, acknowledgements), and CRM sync records.
-- Idempotent on purpose, like 0017..0020: the applied history of existing databases is unknown.
CREATE TABLE IF NOT EXISTS "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(12) DEFAULT 'ACTIVE' NOT NULL,
	"target_url" varchar(500),
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signing_secret_enc" text NOT NULL,
	"credential_enc" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error" varchar(300),
	"disabled_reason" varchar(100),
	"last_validation" jsonb,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status_code" integer,
	"last_error" varchar(300),
	"duration_ms" integer,
	"ack_status" varchar(12),
	"ack_message" varchar(300),
	"acked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"entity_type" varchar(10) NOT NULL,
	"local_id" uuid NOT NULL,
	"external_id" varchar(100),
	"payload_hash" varchar(64) NOT NULL,
	"status" varchar(10) NOT NULL,
	"last_error" varchar(300),
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_records" ADD CONSTRAINT "sync_records_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integrations_user_idx" ON "integrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integrations_status_idx" ON "integrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_deliveries_due_idx" ON "integration_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_deliveries_integration_idx" ON "integration_deliveries" USING btree ("integration_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sync_records_entity_idx" ON "sync_records" USING btree ("integration_id","entity_type","local_id");
