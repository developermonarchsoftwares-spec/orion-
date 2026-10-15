-- Phase 3: report the People ingestion stage on the existing import batch / record rows.
-- Two nullable JSON columns; no data is rewritten and no existing column changes. Idempotent.
ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "people_summary" jsonb;--> statement-breakpoint
ALTER TABLE "import_records" ADD COLUMN IF NOT EXISTS "people_result" jsonb;
