-- Phase 5: field-level verification ledger. Additive and idempotent.
-- Approval (company_people.review_status) and verification are separate decisions.
-- The ledger is the authoritative record of WHO verified WHAT, WHEN, WHY and on WHICH evidence; the existing
-- verification_status columns are derived from it (see modules/people/verification/verification-state.ts).
-- Also adds company_people.title_aliases: earlier normalised titles of a role (reviewer title changes), so
-- re-ingesting the old title resolves to the same role instead of creating a second one.
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "title_aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_type" varchar(20) NOT NULL,
	"target_key" varchar(80) NOT NULL,
	"person_id" uuid NOT NULL,
	"company_person_id" uuid,
	"contact_id" uuid,
	"claimed_value" varchar(300) NOT NULL,
	"status" varchar(12) NOT NULL,
	"evidence_id" uuid,
	"evidence_strength" integer DEFAULT 0 NOT NULL,
	"verified_by_kind" varchar(10) DEFAULT 'REVIEWER' NOT NULL,
	"method" varchar(30) DEFAULT 'REVIEWER_EVIDENCE' NOT NULL,
	"attested_by" varchar(255),
	"verified_by_id" uuid,
	"verified_by_label" varchar(255) NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_verifications_claim_chk" CHECK ("claim_type" IN ('IDENTITY', 'RELATIONSHIP', 'TITLE', 'EMAIL', 'PHONE', 'LINKEDIN')),
	CONSTRAINT "people_verifications_status_chk" CHECK ("status" IN ('VERIFIED', 'DISPUTED')),
	CONSTRAINT "people_verifications_kind_chk" CHECK ("verified_by_kind" IN ('REVIEWER', 'SYSTEM')),
	CONSTRAINT "people_verifications_method_chk" CHECK ("method" IN ('REVIEWER_EVIDENCE', 'INGESTION_ATTESTED', 'LEGACY_BACKFILL')),
	CONSTRAINT "people_verifications_system_no_human_chk" CHECK ("verified_by_kind" = 'REVIEWER' OR "verified_by_id" IS NULL)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_verifications" ADD CONSTRAINT "people_verifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_verifications" ADD CONSTRAINT "people_verifications_company_person_id_company_people_id_fk" FOREIGN KEY ("company_person_id") REFERENCES "public"."company_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_verifications" ADD CONSTRAINT "people_verifications_contact_id_person_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."person_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_verifications" ADD CONSTRAINT "people_verifications_evidence_id_people_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."people_evidence"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_verifications" ADD CONSTRAINT "people_verifications_verified_by_id_users_id_fk" FOREIGN KEY ("verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_verifications_target_value_uq" ON "people_verifications" USING btree ("target_key","claimed_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_verifications_person_idx" ON "people_verifications" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_verifications_role_idx" ON "people_verifications" USING btree ("company_person_id");--> statement-breakpoint
-- Ingestion-attested / earlier verifications that already exist become SYSTEM ledger events, so the ledger and the
-- status columns agree from day one. No human reviewer is invented: verified_by_kind = SYSTEM, no user id, and the
-- source that attested it is recorded in attested_by. Only verifications backed by verified evidence are recorded.
-- Contact values are stored as a digest only (h: + sha256), matching claimedValueFor() in the application.
INSERT INTO "people_verifications" ("claim_type", "target_key", "person_id", "company_person_id", "claimed_value", "status", "evidence_id", "evidence_strength", "verified_by_kind", "method", "attested_by", "verified_by_label", "verified_at", "note")
SELECT c.claim, c.claim || ':' || cp.id, cp.person_id, cp.id,
	CASE c.claim WHEN 'TITLE' THEN cp.normalized_job_title ELSE cp.business_id::text END,
	'VERIFIED', ev.id, 0, 'SYSTEM', 'LEGACY_BACKFILL', ev.source_type::text, 'system:legacy-backfill', cp.last_verified_at,
	'Recorded from a verification stored before the ledger existed; no reviewer involved'
FROM "company_people" cp
CROSS JOIN LATERAL (VALUES ('TITLE'), ('RELATIONSHIP')) AS c(claim)
JOIN LATERAL (
	SELECT e.id, e.source_type FROM "people_evidence" e
	WHERE e.company_person_id = cp.id AND e.verified_at IS NOT NULL
	ORDER BY e.verified_at DESC LIMIT 1
) ev ON true
WHERE cp.verification_status IN ('VERIFIED', 'PARTIALLY_VERIFIED') AND cp.last_verified_at IS NOT NULL
	AND (cp.verification_status = 'VERIFIED' OR c.claim = 'RELATIONSHIP')
ON CONFLICT ("target_key", "claimed_value") DO NOTHING;--> statement-breakpoint
INSERT INTO "people_verifications" ("claim_type", "target_key", "person_id", "contact_id", "claimed_value", "status", "evidence_id", "evidence_strength", "verified_by_kind", "method", "attested_by", "verified_by_label", "verified_at", "note")
SELECT CASE pc.contact_type WHEN 'WORK_EMAIL' THEN 'EMAIL' ELSE 'PHONE' END,
	CASE pc.contact_type WHEN 'WORK_EMAIL' THEN 'EMAIL' ELSE 'PHONE' END || ':' || pc.id, pc.person_id, pc.id,
	'h:' || encode(sha256(convert_to(pc.normalized_value, 'UTF8')), 'hex'),
	'VERIFIED', ev.id, 0, 'SYSTEM', 'LEGACY_BACKFILL', ev.source_type::text, 'system:legacy-backfill', pc.last_verified_at,
	'Recorded from a verification stored before the ledger existed; no reviewer involved'
FROM "person_contacts" pc
JOIN LATERAL (
	SELECT e.id, e.source_type FROM "people_evidence" e
	WHERE e.contact_id = pc.id AND e.verified_at IS NOT NULL
	ORDER BY e.verified_at DESC LIMIT 1
) ev ON true
WHERE pc.verification_status = 'VERIFIED' AND pc.last_verified_at IS NOT NULL
ON CONFLICT ("target_key", "claimed_value") DO NOTHING;
