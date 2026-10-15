-- People ingestion support (phase 2). Additive and idempotent; runs inside Drizzle's transaction.
-- 1. company_people.is_published: role-level publication gate. Roles that already exist were
--    created under the phase 1 rules (visibility = person.data_status), so they keep their
--    visibility: backfilled to true exactly once, at the moment the column is added.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'company_people' AND column_name = 'is_published'
	) THEN
		ALTER TABLE "company_people" ADD COLUMN "is_published" boolean DEFAULT false NOT NULL;
		UPDATE "company_people" SET "is_published" = true;
	END IF;
END $$;--> statement-breakpoint
-- 2. people_evidence.fingerprint: idempotent evidence. Existing rows keep NULL (NULLs never collide).
ALTER TABLE "people_evidence" ADD COLUMN IF NOT EXISTS "fingerprint" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_evidence_fingerprint_uq" ON "people_evidence" USING btree ("fingerprint") WHERE "fingerprint" IS NOT NULL;--> statement-breakpoint
-- 3. Quarantine for rejected ingestion records.
CREATE TABLE IF NOT EXISTS "people_ingestion_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_ref" varchar(100),
	"source_label" varchar(100),
	"fingerprint" varchar(64) NOT NULL,
	"raw" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_quarantine_status_chk" CHECK ("status" IN ('PENDING', 'RESOLVED', 'DISCARDED'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_quarantine_fingerprint_uq" ON "people_ingestion_quarantine" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_quarantine_batch_idx" ON "people_ingestion_quarantine" USING btree ("batch_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_quarantine_status_idx" ON "people_ingestion_quarantine" USING btree ("status");
