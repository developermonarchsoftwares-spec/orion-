-- Phase 6.2: append-only observation history + source-record identity. Additive and idempotent; touches no existing table.
-- An observation says "this source (this version) handed Orion this source record in this run, acquired at T, observed-true at T2,
-- and here is what came of it". It holds no contact data and no raw payload, only a content fingerprint and sizes.
CREATE TABLE IF NOT EXISTS "people_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" varchar(60) NOT NULL,
	"source_version" varchar(20) NOT NULL,
	"source_record_id" varchar(200) NOT NULL,
	"batch_ref" varchar(100) NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone,
	"content_fingerprint" varchar(64) NOT NULL,
	"outcome" varchar(12) NOT NULL,
	"reason_codes" text[],
	"person_id" uuid,
	"company_person_id" uuid,
	"business_id" uuid,
	"evidence_id" uuid,
	"observed_name" varchar(200),
	"observed_title" varchar(200),
	"observed_is_current" boolean,
	"payload_bytes" integer DEFAULT 0 NOT NULL,
	"payload_ref" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_observations_outcome_chk" CHECK ("outcome" IN ('INGESTED', 'QUARANTINED')),
	CONSTRAINT "people_observations_ingested_chk" CHECK ("outcome" <> 'INGESTED' OR "person_id" IS NOT NULL),
	CONSTRAINT "people_observations_bytes_chk" CHECK ("payload_bytes" >= 0 AND "payload_bytes" <= 1048576)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observations" ADD CONSTRAINT "people_observations_source_key_people_sources_key_fk" FOREIGN KEY ("source_key") REFERENCES "public"."people_sources"("key") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observations" ADD CONSTRAINT "people_observations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observations" ADD CONSTRAINT "people_observations_company_person_id_company_people_id_fk" FOREIGN KEY ("company_person_id") REFERENCES "public"."company_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observations" ADD CONSTRAINT "people_observations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observations" ADD CONSTRAINT "people_observations_evidence_id_people_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."people_evidence"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_observations_identity_uq" ON "people_observations" USING btree ("source_key","source_record_id","content_fingerprint","batch_ref","outcome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_observations_record_idx" ON "people_observations" USING btree ("source_key","source_record_id","acquired_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_observations_person_idx" ON "people_observations" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_observations_role_idx" ON "people_observations" USING btree ("company_person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_observations_batch_idx" ON "people_observations" USING btree ("batch_ref");--> statement-breakpoint
-- Append-only: an observation is never edited. The only permitted UPDATE is the database itself nulling evidence_id /
-- business_id when the referenced row is deleted (ON DELETE SET NULL). Deleting an observation (person removal, retention) is allowed.
CREATE OR REPLACE FUNCTION "people_observations_append_only"() RETURNS trigger AS $$
BEGIN
	IF (to_jsonb(NEW) - 'evidence_id' - 'business_id') IS DISTINCT FROM (to_jsonb(OLD) - 'evidence_id' - 'business_id')
		OR (NEW.evidence_id IS NOT NULL AND NEW.evidence_id IS DISTINCT FROM OLD.evidence_id)
		OR (NEW.business_id IS NOT NULL AND NEW.business_id IS DISTINCT FROM OLD.business_id) THEN
		RAISE EXCEPTION 'people_observations is append-only';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "people_observations_append_only_trg" ON "people_observations";--> statement-breakpoint
CREATE TRIGGER "people_observations_append_only_trg" BEFORE UPDATE ON "people_observations" FOR EACH ROW EXECUTE FUNCTION "people_observations_append_only"();
