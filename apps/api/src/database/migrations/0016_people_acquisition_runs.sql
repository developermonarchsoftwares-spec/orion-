-- Phase 6.9: acquisition run records (orchestration state). Additive and idempotent; touches no existing table, back-fills nothing.
-- A run holds limits, counters, an opaque resume cursor and its status. It holds no records, payloads or credentials: record-level
-- truth stays in people_observations (batch_ref is the observation run id).
CREATE TABLE IF NOT EXISTS "people_acquisition_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" varchar(60) NOT NULL,
	"source_version" varchar(20) NOT NULL,
	"batch_ref" varchar(100) NOT NULL,
	"status" varchar(10) DEFAULT 'QUEUED' NOT NULL,
	"max_records" integer NOT NULL,
	"batch_size" integer NOT NULL,
	"max_cost_units" integer,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"backoff_base_ms" integer DEFAULT 1000 NOT NULL,
	"batch_interval_ms" integer DEFAULT 0 NOT NULL,
	"records_seen" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_unchanged" integer DEFAULT 0 NOT NULL,
	"records_quarantined" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"batches_done" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"cursor" text,
	"failure_code" varchar(40),
	"failure_message" varchar(300),
	"claim_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_acquisition_runs_status_chk" CHECK ("people_acquisition_runs"."status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
	CONSTRAINT "people_acquisition_runs_limits_chk" CHECK ("people_acquisition_runs"."max_records" > 0 AND "people_acquisition_runs"."batch_size" > 0 AND "people_acquisition_runs"."batch_size" <= "people_acquisition_runs"."max_records" AND "people_acquisition_runs"."max_retries" >= 0 AND "people_acquisition_runs"."backoff_base_ms" >= 0 AND "people_acquisition_runs"."batch_interval_ms" >= 0 AND ("people_acquisition_runs"."max_cost_units" IS NULL OR "people_acquisition_runs"."max_cost_units" >= 0)),
	CONSTRAINT "people_acquisition_runs_counts_chk" CHECK ("people_acquisition_runs"."records_seen" >= 0 AND "people_acquisition_runs"."records_created" >= 0 AND "people_acquisition_runs"."records_updated" >= 0 AND "people_acquisition_runs"."records_unchanged" >= 0 AND "people_acquisition_runs"."records_quarantined" >= 0 AND "people_acquisition_runs"."records_failed" >= 0 AND "people_acquisition_runs"."records_skipped" >= 0 AND "people_acquisition_runs"."batches_done" >= 0 AND "people_acquisition_runs"."retries" >= 0 AND "people_acquisition_runs"."cost_units" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_acquisition_runs" ADD CONSTRAINT "people_acquisition_runs_source_key_people_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."people_sources"("key") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_acquisition_runs_batch_ref_uq" ON "people_acquisition_runs" USING btree ("batch_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_acquisition_runs_source_idx" ON "people_acquisition_runs" USING btree ("source_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_acquisition_runs_status_idx" ON "people_acquisition_runs" USING btree ("status");