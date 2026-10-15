-- Phase 6.4: durable people suppression registry. Additive and idempotent; touches no existing table.
-- A row says: this deterministic identity signal (LinkedIn, work e-mail, phone) belonged to a suppressed person and must not
-- be reintroduced by future ingestion. Signals are stored only as digests ('h:' + sha256 of the normalised value).
-- Names, titles and company names are never suppression keys. Rows survive deletion of the person row (person_id becomes NULL).
CREATE TABLE IF NOT EXISTS "people_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"identity_kind" varchar(12) NOT NULL,
	"identity_digest" varchar(80) NOT NULL,
	"reason" text,
	"origin" varchar(24) NOT NULL,
	"source_reference" varchar(255),
	"suppressed_by_kind" varchar(10) DEFAULT 'REVIEWER' NOT NULL,
	"suppressed_by_id" uuid,
	"suppressed_by_label" varchar(255),
	"suppressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_suppressions_kind_chk" CHECK ("identity_kind" IN ('LINKEDIN', 'WORK_EMAIL', 'PHONE')),
	CONSTRAINT "people_suppressions_digest_chk" CHECK ("identity_digest" ~ '^h:[0-9a-f]{64}$'),
	CONSTRAINT "people_suppressions_origin_chk" CHECK ("origin" IN ('REVIEWER_ACTION', 'QUARANTINE_ACTION', 'LEGACY_SET_STATUS', 'LEGACY_BACKFILL')),
	CONSTRAINT "people_suppressions_by_kind_chk" CHECK ("suppressed_by_kind" IN ('REVIEWER', 'SYSTEM')),
	CONSTRAINT "people_suppressions_system_no_human_chk" CHECK ("suppressed_by_kind" = 'REVIEWER' OR "suppressed_by_id" IS NULL)
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_suppressions" ADD CONSTRAINT "people_suppressions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_suppressions" ADD CONSTRAINT "people_suppressions_suppressed_by_id_users_id_fk" FOREIGN KEY ("suppressed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_suppressions_identity_uq" ON "people_suppressions" USING btree ("identity_kind","identity_digest");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_suppressions_person_idx" ON "people_suppressions" USING btree ("person_id");--> statement-breakpoint
-- Registry rows are a permanent protection: they are never edited or deleted. The only change the database itself may make is
-- nulling person_id / suppressed_by_id when the referenced row is deleted. Lifting a suppression is a separate, future,
-- explicit administrative operation (it would add its own columns and relax this deliberately).
CREATE OR REPLACE FUNCTION "people_suppressions_immutable"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'people_suppressions rows are never deleted';
	END IF;
	IF (to_jsonb(NEW) - 'person_id' - 'suppressed_by_id') IS DISTINCT FROM (to_jsonb(OLD) - 'person_id' - 'suppressed_by_id')
		OR (NEW.person_id IS NOT NULL AND NEW.person_id IS DISTINCT FROM OLD.person_id)
		OR (NEW.suppressed_by_id IS NOT NULL AND NEW.suppressed_by_id IS DISTINCT FROM OLD.suppressed_by_id) THEN
		RAISE EXCEPTION 'people_suppressions rows are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "people_suppressions_immutable_upd" ON "people_suppressions";--> statement-breakpoint
CREATE TRIGGER "people_suppressions_immutable_upd" BEFORE UPDATE ON "people_suppressions" FOR EACH ROW EXECUTE FUNCTION "people_suppressions_immutable"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "people_suppressions_immutable_del" ON "people_suppressions";--> statement-breakpoint
CREATE TRIGGER "people_suppressions_immutable_del" BEFORE DELETE ON "people_suppressions" FOR EACH ROW EXECUTE FUNCTION "people_suppressions_immutable"();--> statement-breakpoint
-- Persons ALREADY suppressed before the registry existed: register the deterministic identifiers they already hold
-- (their own stored LinkedIn, work e-mails and phone numbers). Nothing is guessed or inferred; a suppressed person who holds
-- no such identifier simply has no registry entry (a documented legacy case). Insert-only and idempotent.
INSERT INTO "people_suppressions" ("person_id", "identity_kind", "identity_digest", "reason", "origin", "suppressed_by_kind", "suppressed_by_label", "suppressed_at")
SELECT p."id", 'LINKEDIN', 'h:' || encode(sha256(convert_to(p."normalized_linkedin_url", 'UTF8')), 'hex'),
	'Registered from a suppression that predates the registry', 'LEGACY_BACKFILL', 'SYSTEM', 'system:legacy-backfill',
	COALESCE((SELECT max(a."created_at") FROM "audit_logs" a WHERE a."entity_id" = p."id"::text AND a."action" = 'PEOPLE_PERSON_SUPPRESSED'), p."updated_at")
FROM "people" p
WHERE p."data_status" = 'SUPPRESSED' AND p."normalized_linkedin_url" IS NOT NULL AND p."normalized_linkedin_url" <> ''
ON CONFLICT ("identity_kind", "identity_digest") DO NOTHING;--> statement-breakpoint
INSERT INTO "people_suppressions" ("person_id", "identity_kind", "identity_digest", "reason", "origin", "suppressed_by_kind", "suppressed_by_label", "suppressed_at")
SELECT p."id", CASE c."contact_type" WHEN 'WORK_EMAIL' THEN 'WORK_EMAIL' ELSE 'PHONE' END, 'h:' || encode(sha256(convert_to(c."normalized_value", 'UTF8')), 'hex'),
	'Registered from a suppression that predates the registry', 'LEGACY_BACKFILL', 'SYSTEM', 'system:legacy-backfill',
	COALESCE((SELECT max(a."created_at") FROM "audit_logs" a WHERE a."entity_id" = p."id"::text AND a."action" = 'PEOPLE_PERSON_SUPPRESSED'), p."updated_at")
FROM "people" p
JOIN "person_contacts" c ON c."person_id" = p."id"
WHERE p."data_status" = 'SUPPRESSED' AND c."normalized_value" IS NOT NULL AND c."normalized_value" <> ''
ON CONFLICT ("identity_kind", "identity_digest") DO NOTHING;
