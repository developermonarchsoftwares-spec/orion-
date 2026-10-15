-- Phase 4: internal review workflow. Additive and idempotent.
-- 1. Role-level review state. Roles that already exist keep their visibility: published roles
--    are backfilled to APPROVED exactly once, at the moment the column is added.
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'company_people' AND column_name = 'review_status'
	) THEN
		ALTER TABLE "company_people" ADD COLUMN "review_status" varchar(20) DEFAULT 'PENDING' NOT NULL;
		UPDATE "company_people" SET "review_status" = 'APPROVED' WHERE "is_published" = true;
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "reviewed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "review_note" text;--> statement-breakpoint
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "classification_source" varchar(10) DEFAULT 'AUTO' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_review_status_chk" CHECK ("review_status" IN ('PENDING', 'APPROVED', 'REJECTED', 'QUARANTINED'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_classification_source_chk" CHECK ("classification_source" IN ('AUTO', 'REVIEWER'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_published_approved_chk" CHECK ("is_published" = false OR "review_status" = 'APPROVED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_review_idx" ON "company_people" USING btree ("review_status","created_at");--> statement-breakpoint
-- 2. Earlier normalised names after a reviewer correction, so re-ingesting the old spelling does not create a duplicate person.
ALTER TABLE "people" ADD COLUMN IF NOT EXISTS "name_aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- 3. How a reviewer closed a quarantine item.
ALTER TABLE "people_ingestion_quarantine" ADD COLUMN IF NOT EXISTS "resolution" jsonb;
