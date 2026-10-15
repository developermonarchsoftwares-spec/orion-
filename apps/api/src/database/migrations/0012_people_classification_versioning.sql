-- Phase 6.5: classification versioning. Additive and idempotent; no existing column or row is changed or removed.
-- Existing roles keep exactly the department / seniority / decision-maker values they have; their classification_version stays
-- NULL (= classified before versioning existed). Nothing is back-filled and no reviewer decision is touched.
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "classification_version" varchar(20);--> statement-breakpoint
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "classification_strength" varchar(16);--> statement-breakpoint
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "classified_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_classification_strength_chk" CHECK ("classification_strength" IS NULL OR "classification_strength" IN ('EXACT_RULE', 'NORMALIZED_RULE', 'FALLBACK', 'UNCLASSIFIED'));
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "people_observations" ADD COLUMN IF NOT EXISTS "normalized_title" varchar(200);--> statement-breakpoint
ALTER TABLE "people_observations" ADD COLUMN IF NOT EXISTS "classification_version" varchar(20);--> statement-breakpoint
-- Append-only history of every classification of a role: what a taxonomy version decided (SYSTEM_CLASSIFICATION) and what a
-- reviewer decided (REVIEWER_OVERRIDE). The two are never merged and neither replaces the other.
CREATE TABLE IF NOT EXISTS "company_people_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_person_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"taxonomy_version" varchar(20),
	"normalized_title" varchar(200) NOT NULL,
	"seniority_level" varchar(30) NOT NULL,
	"department" varchar(40) NOT NULL,
	"decision_maker_type" varchar(60),
	"relationship_type" varchar(30),
	"rule_id" varchar(300),
	"rule_trace" jsonb,
	"strength" varchar(16),
	"actor_kind" varchar(10) DEFAULT 'SYSTEM' NOT NULL,
	"actor_id" uuid,
	"actor_label" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_people_classifications_kind_chk" CHECK ("kind" IN ('SYSTEM_CLASSIFICATION', 'REVIEWER_OVERRIDE')),
	CONSTRAINT "company_people_classifications_version_chk" CHECK ("kind" = 'REVIEWER_OVERRIDE' OR "taxonomy_version" IS NOT NULL),
	CONSTRAINT "company_people_classifications_actor_chk" CHECK ("actor_kind" IN ('SYSTEM', 'REVIEWER')),
	CONSTRAINT "company_people_classifications_strength_chk" CHECK ("strength" IS NULL OR "strength" IN ('EXACT_RULE', 'NORMALIZED_RULE', 'FALLBACK', 'UNCLASSIFIED'))
);--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people_classifications" ADD CONSTRAINT "company_people_classifications_company_person_id_company_people_id_fk" FOREIGN KEY ("company_person_id") REFERENCES "public"."company_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people_classifications" ADD CONSTRAINT "company_people_classifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_people_classifications_system_uq" ON "company_people_classifications" USING btree ("company_person_id","taxonomy_version","normalized_title") WHERE "company_people_classifications"."kind" = 'SYSTEM_CLASSIFICATION';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_classifications_role_idx" ON "company_people_classifications" USING btree ("company_person_id","created_at");--> statement-breakpoint
-- Append-only: a history row is never edited. The only permitted UPDATE is the database itself nulling actor_id when the
-- reviewer account is deleted. Rows are removed only with their role (cascade).
CREATE OR REPLACE FUNCTION "company_people_classifications_append_only"() RETURNS trigger AS $$
BEGIN
	IF (to_jsonb(NEW) - 'actor_id') IS DISTINCT FROM (to_jsonb(OLD) - 'actor_id')
		OR (NEW.actor_id IS NOT NULL AND NEW.actor_id IS DISTINCT FROM OLD.actor_id) THEN
		RAISE EXCEPTION 'company_people_classifications is append-only';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "company_people_classifications_append_only_trg" ON "company_people_classifications";--> statement-breakpoint
CREATE TRIGGER "company_people_classifications_append_only_trg" BEFORE UPDATE ON "company_people_classifications" FOR EACH ROW EXECUTE FUNCTION "company_people_classifications_append_only"();
