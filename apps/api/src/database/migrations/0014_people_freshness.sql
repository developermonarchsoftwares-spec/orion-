-- Phase 6.7: freshness timestamps. Additive and idempotent; nullable columns only, no back-fill, no existing value changed.
-- last_seen_at = when Orion last saw THIS claim again; last_confirmed_at = when a reviewer last accepted it.
-- Neither is verification (verified_at stays in the verification ledger). NULL = never / unknown.
ALTER TABLE "company_people" ADD COLUMN IF NOT EXISTS "last_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person_contacts" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "person_contacts" ADD COLUMN IF NOT EXISTS "last_confirmed_at" timestamp with time zone;
