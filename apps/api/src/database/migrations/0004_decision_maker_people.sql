-- Decision Maker Intelligence (customer-facing People layer), phase 1.
-- Additive only: new enum + 5 new tables + one nullable column on saved_leads.
-- Idempotent: safe to re-run. Drizzle's migrator runs this file inside a transaction.
DO $$ BEGIN
	CREATE TYPE "public"."person_verification_status" AS ENUM('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED', 'STALE', 'CONFLICTED');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar(100),
	"middle_name" varchar(100),
	"last_name" varchar(100),
	"full_name" varchar(200) NOT NULL,
	"normalized_name" varchar(200) NOT NULL,
	"linkedin_url" text,
	"normalized_linkedin_url" varchar(300),
	"photo_url" text,
	"city" varchar(100),
	"state" varchar(100),
	"country" varchar(100),
	"data_status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"verification_status" "person_verification_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_data_status_chk" CHECK ("data_status" IN ('DRAFT', 'PUBLISHED', 'SUPPRESSED')),
	CONSTRAINT "people_confidence_chk" CHECK ("confidence_score" BETWEEN 0 AND 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"relationship_type" varchar(30) DEFAULT 'EMPLOYEE' NOT NULL,
	"job_title_at_company" varchar(200) NOT NULL,
	"normalized_job_title" varchar(200) NOT NULL,
	"department" varchar(40) DEFAULT 'UNKNOWN' NOT NULL,
	"seniority_level" varchar(30) DEFAULT 'UNKNOWN' NOT NULL,
	"decision_maker_type" varchar(60),
	"is_current" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"end_date" date,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"verification_status" "person_verification_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_people_confidence_chk" CHECK ("confidence_score" BETWEEN 0 AND 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"contact_type" varchar(20) NOT NULL,
	"contact_value" varchar(255) NOT NULL,
	"normalized_value" varchar(255) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"verification_status" "person_verification_status" DEFAULT 'UNVERIFIED' NOT NULL,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"source_type" "data_source_type",
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_contacts_type_chk" CHECK ("contact_type" IN ('WORK_EMAIL', 'PHONE', 'MOBILE')),
	CONSTRAINT "person_contacts_confidence_chk" CHECK ("confidence_score" BETWEEN 0 AND 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "people_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"company_person_id" uuid,
	"contact_id" uuid,
	"source_type" "data_source_type" NOT NULL,
	"evidence_type" varchar(40) NOT NULL,
	"source_url" text,
	"source_reference" varchar(255),
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_evidence_confidence_chk" CHECK ("confidence_score" BETWEEN 0 AND 100)
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "person_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"credits_spent" integer DEFAULT 1 NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "saved_leads" ADD COLUMN IF NOT EXISTS "person_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "company_people" ADD CONSTRAINT "company_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "person_contacts" ADD CONSTRAINT "person_contacts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_evidence" ADD CONSTRAINT "people_evidence_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_evidence" ADD CONSTRAINT "people_evidence_company_person_id_company_people_id_fk" FOREIGN KEY ("company_person_id") REFERENCES "public"."company_people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "people_evidence" ADD CONSTRAINT "people_evidence_contact_id_person_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."person_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "person_unlocks" ADD CONSTRAINT "person_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "person_unlocks" ADD CONSTRAINT "person_unlocks_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "saved_leads" ADD CONSTRAINT "saved_leads_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_norm_linkedin_idx" ON "people" USING btree ("normalized_linkedin_url") WHERE "normalized_linkedin_url" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_normalized_name_idx" ON "people" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_data_status_idx" ON "people" USING btree ("data_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_city_idx" ON "people" USING btree ("city");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_state_idx" ON "people" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_people_role_uq" ON "company_people" USING btree ("business_id","person_id","normalized_job_title");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_business_current_idx" ON "company_people" USING btree ("business_id","is_current");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_person_idx" ON "company_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_dm_type_idx" ON "company_people" USING btree ("decision_maker_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_department_idx" ON "company_people" USING btree ("department");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_people_seniority_idx" ON "company_people" USING btree ("seniority_level");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_contacts_uq" ON "person_contacts" USING btree ("person_id","contact_type","normalized_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_contacts_lookup_idx" ON "person_contacts" USING btree ("contact_type","normalized_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_contacts_person_idx" ON "person_contacts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_evidence_person_idx" ON "people_evidence" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_evidence_company_person_idx" ON "people_evidence" USING btree ("company_person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_evidence_contact_idx" ON "people_evidence" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_unlocks_user_person_idx" ON "person_unlocks" USING btree ("user_id","person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_unlocks_user_idx" ON "person_unlocks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_unlocks_person_idx" ON "person_unlocks" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_leads_person_idx" ON "saved_leads" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "saved_leads_user_business_person_uq" ON "saved_leads" USING btree ("user_id","business_id","person_id") WHERE "person_id" IS NOT NULL;
