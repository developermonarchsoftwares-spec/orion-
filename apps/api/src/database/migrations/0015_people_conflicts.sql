-- Phase 6.8: conflict detection records. Additive and idempotent; touches no existing table, back-fills nothing.
-- A conflict says "these claims disagree"; it never picks a winner and changes no verification, publication or suppression.
-- people_conflicts: one row per (type, subject_key). people_conflict_links: the claims behind it, by reference to existing
-- observation / claim / evidence / person / role / contact rows (append-only).
CREATE TABLE IF NOT EXISTS "people_conflict_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conflict_id" uuid NOT NULL,
	"link_key" varchar(200) NOT NULL,
	"observation_id" uuid,
	"observation_claim_id" uuid,
	"evidence_id" uuid,
	"person_id" uuid,
	"company_person_id" uuid,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conflict_type" varchar(40) NOT NULL,
	"subject_key" varchar(200) NOT NULL,
	"status" varchar(10) DEFAULT 'OPEN' NOT NULL,
	"person_id" uuid,
	"business_id" uuid,
	"details" jsonb,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_conflicts_status_chk" CHECK ("people_conflicts"."status" IN ('OPEN', 'RESOLVED')),
	CONSTRAINT "people_conflicts_type_chk" CHECK ("people_conflicts"."conflict_type" IN ('CONTACT_MULTIPLE_PEOPLE', 'IDENTITY_LINKEDIN', 'CONTACT_CONFLICTING_VALUES', 'ROLE_TITLE', 'ROLE_CURRENCY', 'COMPANY_RELATIONSHIP'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_conflict_id_people_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."people_conflicts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_observation_id_people_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."people_observations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_observation_claim_id_people_observation_claims_id_fk" FOREIGN KEY ("observation_claim_id") REFERENCES "public"."people_observation_claims"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_evidence_id_people_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."people_evidence"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_company_person_id_company_people_id_fk" FOREIGN KEY ("company_person_id") REFERENCES "public"."company_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflict_links" ADD CONSTRAINT "people_conflict_links_contact_id_person_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."person_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflicts" ADD CONSTRAINT "people_conflicts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_conflicts" ADD CONSTRAINT "people_conflicts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_conflict_links_uq" ON "people_conflict_links" USING btree ("conflict_id","link_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_conflict_links_observation_idx" ON "people_conflict_links" USING btree ("observation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_conflicts_subject_uq" ON "people_conflicts" USING btree ("conflict_type","subject_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_conflicts_person_idx" ON "people_conflicts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_conflicts_status_idx" ON "people_conflicts" USING btree ("status","last_detected_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "people_conflict_links_append_only"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'people_conflict_links is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "people_conflict_links_append_only_trg" ON "people_conflict_links";--> statement-breakpoint
CREATE TRIGGER "people_conflict_links_append_only_trg" BEFORE UPDATE ON "people_conflict_links" FOR EACH ROW EXECUTE FUNCTION "people_conflict_links_append_only"();
