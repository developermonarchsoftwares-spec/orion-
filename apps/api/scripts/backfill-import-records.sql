-- Backfill import_records for batches that created businesses but stored no records (written by the old gateway upload).
-- Idempotent and safe to re-run: only batches with ZERO import_records are touched, and a business that is already the target of an
-- import_record is never linked twice. Nothing is created in `businesses`.
-- A batch is repaired only when the candidate businesses match its total_records EXACTLY (created in the batch's time window, no
-- record yet); otherwise it is skipped and left for manual review, so rows are never attached to the wrong batch.
-- Run inside a transaction (the runner does this): BEGIN; \i this file; COMMIT;

WITH broken AS (
  SELECT b.id, b.created_at, b.total_records
  FROM import_batches b
  WHERE b.total_records > 0
    AND NOT EXISTS (SELECT 1 FROM import_records r WHERE r.batch_id = b.id)
),
cand AS (
  SELECT br.id AS batch_id, bz.id AS business_id, bz.name, bz.created_at AS biz_created,
         l.city, l.state,
         count(*) OVER (PARTITION BY br.id) AS n, br.total_records
  FROM broken br
  JOIN businesses bz
    ON bz.created_at >= br.created_at - interval '5 seconds'
   AND bz.created_at <= br.created_at + interval '10 minutes'
  LEFT JOIN business_locations l ON l.business_id = bz.id AND l.is_primary
  WHERE NOT EXISTS (SELECT 1 FROM import_records x WHERE x.target_business_id = bz.id)
),
exact AS (SELECT * FROM cand WHERE n = total_records)
INSERT INTO import_records (batch_id, row_number, status, raw_payload, normalized_payload, target_business_id, created_at, updated_at)
SELECT batch_id,
       row_number() OVER (PARTITION BY batch_id ORDER BY biz_created, business_id),
       'NORMALIZED',
       jsonb_build_object('name', name, 'backfilled', true),
       jsonb_build_object('name', name, 'city', city, 'state', state),
       business_id, biz_created, now()
FROM exact;
