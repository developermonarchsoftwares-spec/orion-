-- Phase 6.6: contact provenance. Additive and idempotent; touches no existing table and back-fills nothing.
-- A row says: this observation (and therefore this source, source version, source record and run) claimed this contact point,
-- backed by this evidence row. Values are stored only as digests ('h:' + sha256 of the normalised value). "Reported by a source"
-- is not "verified": verification stays in the verification ledger.
CREATE TABLE IF NOT EXISTS "people_observation_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"observation_id" uuid NOT NULL,
	"claim_type" varchar(12) NOT NULL,
	"contact_id" uuid,
	"value_digest" varchar(80) NOT NULL,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_observation_claims_type_chk" CHECK ("claim_type" IN ('WORK_EMAIL', 'PHONE', 'MOBILE', 'LINKEDIN')),
	CONSTRAINT "people_observation_claims_digest_chk" CHECK ("value_digest" ~ '^h:[0-9a-f]{64}$')
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observation_claims" ADD CONSTRAINT "people_observation_claims_observation_id_people_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."people_observations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observation_claims" ADD CONSTRAINT "people_observation_claims_contact_id_person_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."person_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_observation_claims" ADD CONSTRAINT "people_observation_claims_evidence_id_people_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."people_evidence"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_observation_claims_uq" ON "people_observation_claims" USING btree ("observation_id","claim_type","value_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_observation_claims_contact_idx" ON "people_observation_claims" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_observation_claims_evidence_idx" ON "people_observation_claims" USING btree ("evidence_id");--> statement-breakpoint
-- Append-only: a claim is never edited. The only permitted UPDATE is the database nulling evidence_id when the evidence row is
-- deleted (ON DELETE SET NULL). Rows are removed only with their observation or contact (cascade).
CREATE OR REPLACE FUNCTION "people_observation_claims_append_only"() RETURNS trigger AS $$
BEGIN
	IF (to_jsonb(NEW) - 'evidence_id') IS DISTINCT FROM (to_jsonb(OLD) - 'evidence_id')
		OR (NEW.evidence_id IS NOT NULL AND NEW.evidence_id IS DISTINCT FROM OLD.evidence_id) THEN
		RAISE EXCEPTION 'people_observation_claims is append-only';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "people_observation_claims_append_only_trg" ON "people_observation_claims";--> statement-breakpoint
CREATE TRIGGER "people_observation_claims_append_only_trg" BEFORE UPDATE ON "people_observation_claims" FOR EACH ROW EXECUTE FUNCTION "people_observation_claims_append_only"();
