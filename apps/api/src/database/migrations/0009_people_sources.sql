-- Phase 6.1: people source registry. Additive and idempotent; touches no existing table.
-- A row DESCRIBES a source (what it is, whether it may be used, what it may claim). It holds no credentials.
-- Adapters supply records; only the People ingestion service writes People data.
CREATE TABLE IF NOT EXISTS "people_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(60) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"source_type" "data_source_type" NOT NULL,
	"version" varchar(20) DEFAULT '1' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"terms_reference" varchar(255),
	"terms_acknowledged_at" timestamp with time zone,
	"cost_class" varchar(10) DEFAULT 'NONE' NOT NULL,
	"freshness_ttl_days" integer,
	"max_attestation" varchar(10) DEFAULT 'NONE' NOT NULL,
	"allowed_evidence_types" text[],
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_sources_key_chk" CHECK ("key" ~ '^[a-z0-9][a-z0-9._-]{1,58}$'),
	CONSTRAINT "people_sources_version_chk" CHECK (length(trim("version")) > 0),
	CONSTRAINT "people_sources_cost_chk" CHECK ("cost_class" IN ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
	CONSTRAINT "people_sources_attestation_chk" CHECK ("max_attestation" IN ('NONE', 'PARTIAL', 'FULL')),
	CONSTRAINT "people_sources_ttl_chk" CHECK ("freshness_ttl_days" IS NULL OR "freshness_ttl_days" > 0),
	CONSTRAINT "people_sources_policy_chk" CHECK (jsonb_typeof("policy") = 'object'),
	CONSTRAINT "people_sources_enabled_terms_chk" CHECK ("enabled" = false OR "terms_acknowledged_at" IS NOT NULL),
	CONSTRAINT "people_sources_evidence_types_chk" CHECK ("allowed_evidence_types" IS NOT NULL OR "source_type" IN ('MANUAL_IMPORT', 'USER_SUBMISSION'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_sources_key_uq" ON "people_sources" USING btree ("key");--> statement-breakpoint
-- Deterministic, idempotent seed: ONLY the sources that already exist in the codebase. No external provider is registered.
-- They keep today's behaviour exactly: every permission granted, unrestricted evidence types, source type not overridden,
-- attestation up to FULL (what the normaliser already accepted). Fixed ids and timestamps make the seed reproducible.
INSERT INTO "people_sources" ("id", "key", "display_name", "source_type", "version", "enabled", "terms_reference", "terms_acknowledged_at", "cost_class", "freshness_ttl_days", "max_attestation", "allowed_evidence_types", "policy", "created_at", "updated_at") VALUES
	('00000000-0000-4000-8000-000000000001', 'people-csv', 'People CSV import', 'MANUAL_IMPORT', '1', true, 'internal: built-in source, no third-party terms', '2026-09-30T00:00:00Z', 'NONE', NULL, 'FULL', NULL, '{"permissions":{"identity":true,"title":true,"email":true,"phone":true,"linkedin":true,"evidence":true,"attestation":true},"enforceSourceType":false}'::jsonb, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z'),
	('00000000-0000-4000-8000-000000000002', 'people-json', 'People JSON ingestion', 'MANUAL_IMPORT', '1', true, 'internal: built-in source, no third-party terms', '2026-09-30T00:00:00Z', 'NONE', NULL, 'FULL', NULL, '{"permissions":{"identity":true,"title":true,"email":true,"phone":true,"linkedin":true,"evidence":true,"attestation":true},"enforceSourceType":false}'::jsonb, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z'),
	('00000000-0000-4000-8000-000000000003', 'company-upload', 'Company upload (People bridge)', 'MANUAL_IMPORT', '1', true, 'internal: built-in source, no third-party terms', '2026-09-30T00:00:00Z', 'NONE', NULL, 'FULL', NULL, '{"permissions":{"identity":true,"title":true,"email":true,"phone":true,"linkedin":true,"evidence":true,"attestation":true},"enforceSourceType":false}'::jsonb, '2026-09-30T00:00:00Z', '2026-09-30T00:00:00Z')
ON CONFLICT ("key") DO NOTHING;
