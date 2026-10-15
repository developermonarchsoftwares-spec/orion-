-- =====================================================================================================================
-- ORION PHASE A2: READ-ONLY EVIDENCE CHECKS (reviewed, NOT executed)
-- =====================================================================================================================
-- Status      : prepared for human approval. Nothing in this file has been run against any database.
-- Targets     : the Neon database shared by the Orion application (Drizzle) and the Orion Data Pipeline (psycopg).
-- Guarantees  : every check is its own `BEGIN READ ONLY ... ROLLBACK` block with short timeouts, so (a) the server itself refuses
--               writes, (b) a permission error in one check cannot abort the others, and (c) nothing is left open.
--               Only SELECT statements, catalogue reads and aggregates. No DDL, DML, GRANT, SET ROLE or function that writes.
-- Never selected (by design): query text (pg_stat_activity.query), view or function definitions (pg_views.definition,
--               pg_get_viewdef, pg_get_functiondef), client addresses, role passwords (pg_authid is NOT used), row values of
--               import_batches (file names, object keys, URIs, checksums), user / customer columns, execution_logs messages.
-- Run it    : connect with the DIRECT Neon endpoint (not the -pooler one: pooled sessions hide the real connection picture and
--               transaction-mode pooling does not keep SET LOCAL semantics reliably), using psql or any client that runs the
--               statements one by one and keeps going after an error (psql: default behaviour; do NOT use ON_ERROR_STOP).
--               An error in a check (42P01 relation does not exist, 42703 column does not exist, 42501 permission denied)
--               is itself evidence: record it, do not "fix" the query.
-- Output      : save the result sets as-is. Each result row starts with its check id (C00, C01, ...).
-- Time        : all checks together should complete in a few seconds; each is capped at 15 s.
-- Sensitivity : see the table in PHASE_A2_CHECKLIST.md (column "Exposure").
-- =====================================================================================================================


-- ---------------------------------------------------------------------------------------------------------------------
-- C00  Session sanity and visibility
--   Confirms the server is enforcing read-only, which database and server version this is, and whether the connected role can
--   see other sessions' details (needed to interpret C10). Exposure: role name, database name (low).
--   ELEVATED: no. STOP if read_only <> 'on'.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SELECT 'C00' AS check_id,
       current_setting('transaction_read_only')                          AS read_only,
       current_database()                                                AS database_name,
       current_setting('server_version')                                 AS server_version,
       (now() AT TIME ZONE 'UTC')                                        AS server_time_utc,
       current_user                                                      AS connected_role,
       pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER')          AS can_read_all_stats,
       pg_has_role(current_user, 'pg_monitor', 'MEMBER')                 AS is_pg_monitor;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C01  Orion (Drizzle) migration history compared with the repository journal
--   drizzle.__drizzle_migrations stores (id, hash text, created_at bigint). Drizzle runs a journal entry only when its
--   `when` value is GREATER than the newest created_at recorded, and it never compares hashes. The expected list below is
--   apps/api/src/database/migrations/meta/_journal.json (18 entries) with the first 8 hex digits of sha256(file bytes) as
--   Drizzle computes them. A hash difference with identical line endings means the file was edited after being applied;
--   CRLF/LF differences also change the hash, so treat a mismatch as a question, not a verdict.
--   Exposure: migration names and timestamps (none). ELEVATED: no.
--   STOP / escalate if: any row has in_journal = false (history from a different journal), or the newest applied value is
--   larger than 1796500000000 (a newer journal was applied).
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH expected(idx, tag, when_ms, hash8) AS (
  VALUES
    (0, '0000_bent_johnny_storm', 1789041177967::bigint, '3300fe59'),
    (1, '0001_blushing_loa', 1789059537220::bigint, '7aca2530'),
    (2, '0002_typical_clint_barton', 1789061231383::bigint, '2bb75d61'),
    (3, '0003_seed_packages', 1789100000000::bigint, 'c6ef5c9b'),
    (4, '0004_decision_maker_people', 1790000000000::bigint, 'ab9c6366'),
    (5, '0005_people_ingestion', 1790500000000::bigint, '40bbfcca'),
    (6, '0006_import_people_report', 1791000000000::bigint, 'f4bfea54'),
    (7, '0007_people_review', 1791500000000::bigint, '51b61447'),
    (8, '0008_people_verification', 1792000000000::bigint, '6b277477'),
    (9, '0009_people_sources', 1792500000000::bigint, '74c5e5c2'),
    (10, '0010_people_observations', 1793000000000::bigint, '5d3cd8ad'),
    (11, '0011_people_suppression', 1793500000000::bigint, 'b64823b9'),
    (12, '0012_people_classification_versioning', 1794000000000::bigint, '047ea070'),
    (13, '0013_people_contact_provenance', 1794500000000::bigint, '96f20855'),
    (14, '0014_people_freshness', 1795000000000::bigint, 'a62f3f02'),
    (15, '0015_people_conflicts', 1795500000000::bigint, '8a92e868'),
    (16, '0016_people_acquisition_runs', 1796000000000::bigint, 'e101cd16'),
    (17, '0017_queue_jobs_admin_otps', 1796500000000::bigint, '3da588a7')
),
applied AS (
  SELECT id, created_at, left(hash, 8) AS hash8
  FROM drizzle.__drizzle_migrations
)
SELECT 'C01' AS check_id,
       e.idx,
       e.tag,
       COALESCE(e.when_ms, a.created_at)  AS when_ms,
       (a.created_at IS NOT NULL)         AS applied,
       (e.when_ms IS NOT NULL)            AS in_journal,
       (a.hash8 = e.hash8)                AS hash_matches,
       a.id                               AS history_row_id
FROM expected e
FULL OUTER JOIN applied a ON a.created_at = e.when_ms
ORDER BY COALESCE(e.idx, 999), a.created_at;
SELECT 'C01s' AS check_id,
       count(*)::int      AS history_rows,
       max(created_at)    AS newest_applied_ms,
       min(created_at)    AS oldest_applied_ms
FROM drizzle.__drizzle_migrations;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C02  Pipeline migration history compared with the pipeline repository's migration directory
--   schema_migrations(version varchar PK, applied_at). The pipeline records FILE NAMES only (no hashes), so edits to an applied
--   file are undetectable from the database. The expected list is migrations/*.sql at the pipeline repository HEAD (14 files).
--   Variants without ".sql" and names that are not in the directory are expected to show up (see checklist: PRIOR evidence).
--   Exposure: migration file names (none). ELEVATED: no.
--   STOP / escalate if: a recorded version for 013 or 014 exists that differs from the repository's names, or the table is in
--   another schema (42P01).
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH expected(version) AS (
  VALUES
    ('001_create_deduplication_tables.sql'),
    ('002_add_extended_deduplication_indexes.sql'),
    ('003_create_import_batches.sql'),
    ('004_create_verification_tables.sql'),
    ('005_create_publishing_layer.sql'),
    ('006_create_enrichment_layer.sql'),
    ('007_create_freshness_and_incremental_layer.sql'),
    ('008_enhance_discovery_and_indexing.sql'),
    ('009_create_pipeline_jobs_queue.sql'),
    ('010_create_entity_resolution_layer.sql'),
    ('011_create_customer_commercial_layer.sql'),
    ('012_create_lead_management_and_export_layer.sql'),
    ('013_create_people_intelligence_layer.sql'),
    ('014_create_execution_logs.sql')
),
recorded AS (
  SELECT version, applied_at FROM public.schema_migrations
)
SELECT 'C02' AS check_id,
       COALESCE(e.version, r.version)            AS version,
       (e.version IS NOT NULL)                   AS in_current_repo,
       (r.version IS NOT NULL)                   AS recorded_in_database,
       (r.applied_at AT TIME ZONE 'UTC')         AS applied_at_utc
FROM expected e
FULL OUTER JOIN recorded r ON r.version = e.version
ORDER BY 2;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C03  Schemas and relation ownership (aggregates by owner)
--   Who owns what, and whether the boundary schemas already exist. Names of roles and schemas only.
--   Exposure: role names (low). ELEVATED: no (pg_class / pg_namespace are world-readable).
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C03a' AS check_id, nspname AS schema_name, pg_get_userbyid(nspowner) AS schema_owner
FROM pg_namespace
WHERE nspname NOT LIKE 'pg\_%' AND nspname <> 'information_schema'
ORDER BY 2;
SELECT 'C03b' AS check_id,
       n.nspname                         AS schema_name,
       c.relkind::text                   AS relkind,           -- r table, p partitioned table, v view, m materialized view
       pg_get_userbyid(c.relowner)       AS owner,
       count(*)::int                     AS relations
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
  AND c.relkind IN ('r', 'p', 'v', 'm')
GROUP BY n.nspname, c.relkind, pg_get_userbyid(c.relowner)
ORDER BY 2, 3, 4;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C04  Presence of the objects at the boundary (existence only)
--   to_regclass returns NULL (no error) for a missing relation or schema.
--   Exposure: none. ELEVATED: no.
--   Interpretation: public.people / public.person_contacts / public.company_person_relationships existing means one
--   system's People DDL has already run; orion_pipeline.* existing means a prior boundary attempt.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C04' AS check_id,
       o.obj                                             AS object_name,
       (to_regclass(o.obj) IS NOT NULL)                  AS object_exists,
       (SELECT c.relkind::text FROM pg_class c WHERE c.oid = to_regclass(o.obj)) AS relkind
FROM unnest(ARRAY[
  'public.people', 'public.person_contacts', 'public.company_people',
  'public.company_person_relationships', 'public.person_import_records', 'public.person_change_history', 'public.person_conflicts',
  'public.people_conflicts', 'public.orion_published_people', 'public.orion_published_businesses',
  'public.import_batches', 'public.import_logs', 'public.pipeline_jobs', 'public.execution_logs', 'public.accounts', 'public.user_sessions',
  'public.schema_migrations', 'drizzle.__drizzle_migrations', 'public.queue_jobs', 'public.admin_otps',
  'orion_pipeline.people', 'orion_pipeline.person_contacts'
]) AS o(obj)
ORDER BY 2;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C05  Column comparison for the seven tables both applications touch, against the Orion Drizzle snapshot (0017)
--   Expected columns are generated from apps/api/src/database/migrations/meta/0017_snapshot.json. The comparison uses
--   pg_attribute / format_type (so enum types and varchar lengths are compared as PostgreSQL prints them; enum types may
--   print schema-qualified, which shows up as TYPE_DIFFERS and must be read, not trusted blindly).
--   Findings: MISSING_IN_DB, EXTRA_IN_DB (a column the Orion schema does not define: pipeline or out-of-band), TYPE_DIFFERS,
--   NULLABLE_BUT_EXPECTED_NOT_NULL, NOT_NULL_BUT_EXPECTED_NULLABLE. Rows that agree are not returned (C05b gives the counts).
--   EXTRA_IN_DB with actual_not_null = true and has_default = false is the dangerous case: Orion's inserts would fail.
--   Exposure: column names and types only. ELEVATED: no.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH expected(tbl, col, typ, not_null) AS (
  VALUES
    ('import_batches', 'id', 'uuid', true),
    ('import_batches', 'source_id', 'uuid', false),
    ('import_batches', 'created_by_id', 'uuid', false),
    ('import_batches', 'filename', 'character varying(255)', true),
    ('import_batches', 'file_key', 'text', true),
    ('import_batches', 'file_size', 'integer', true),
    ('import_batches', 'mime_type', 'character varying(100)', true),
    ('import_batches', 'status', 'import_status', true),
    ('import_batches', 'total_records', 'integer', true),
    ('import_batches', 'processed_records', 'integer', true),
    ('import_batches', 'successful_records', 'integer', true),
    ('import_batches', 'failed_records', 'integer', true),
    ('import_batches', 'duplicate_records', 'integer', true),
    ('import_batches', 'mapping_config', 'jsonb', true),
    ('import_batches', 'options', 'jsonb', true),
    ('import_batches', 'error_message', 'text', false),
    ('import_batches', 'people_summary', 'jsonb', false),
    ('import_batches', 'started_at', 'timestamp with time zone', false),
    ('import_batches', 'completed_at', 'timestamp with time zone', false),
    ('import_batches', 'created_at', 'timestamp with time zone', true),
    ('import_batches', 'updated_at', 'timestamp with time zone', true),
    ('users', 'id', 'uuid', true),
    ('users', 'email', 'character varying(255)', true),
    ('users', 'password_hash', 'character varying(255)', false),
    ('users', 'first_name', 'character varying(100)', true),
    ('users', 'last_name', 'character varying(100)', true),
    ('users', 'display_name', 'character varying(200)', false),
    ('users', 'role', 'user_role', true),
    ('users', 'status', 'user_status', true),
    ('users', 'provider', 'character varying(50)', true),
    ('users', 'provider_id', 'character varying(255)', false),
    ('users', 'google_id', 'character varying(255)', false),
    ('users', 'microsoft_id', 'character varying(255)', false),
    ('users', 'avatar_url', 'text', false),
    ('users', 'profile_picture', 'text', false),
    ('users', 'phone_number', 'character varying(50)', false),
    ('users', 'organization_id', 'uuid', false),
    ('users', 'organization_name', 'character varying(255)', false),
    ('users', 'is_email_verified', 'boolean', true),
    ('users', 'email_verified_at', 'timestamp with time zone', false),
    ('users', 'two_factor_enabled', 'boolean', true),
    ('users', 'two_factor_secret', 'text', false),
    ('users', 'metadata', 'jsonb', false),
    ('users', 'last_login_provider', 'character varying(50)', false),
    ('users', 'last_login_at', 'timestamp with time zone', false),
    ('users', 'created_at', 'timestamp with time zone', true),
    ('users', 'updated_at', 'timestamp with time zone', true),
    ('credit_transactions', 'id', 'uuid', true),
    ('credit_transactions', 'wallet_id', 'uuid', true),
    ('credit_transactions', 'user_id', 'uuid', true),
    ('credit_transactions', 'amount', 'integer', true),
    ('credit_transactions', 'balance_after', 'integer', true),
    ('credit_transactions', 'balance_type', 'character varying(50)', false),
    ('credit_transactions', 'daily_balance_after', 'integer', false),
    ('credit_transactions', 'purchased_balance_after', 'integer', false),
    ('credit_transactions', 'type', 'credit_transaction_type', true),
    ('credit_transactions', 'description', 'character varying(255)', true),
    ('credit_transactions', 'reference_id', 'character varying(255)', false),
    ('credit_transactions', 'metadata', 'jsonb', false),
    ('credit_transactions', 'created_at', 'timestamp with time zone', true),
    ('saved_searches', 'id', 'uuid', true),
    ('saved_searches', 'user_id', 'uuid', true),
    ('saved_searches', 'name', 'character varying(150)', true),
    ('saved_searches', 'filters', 'jsonb', true),
    ('saved_searches', 'alert_enabled', 'boolean', true),
    ('saved_searches', 'alert_frequency', 'character varying(50)', true),
    ('saved_searches', 'last_alert_sent_at', 'timestamp with time zone', false),
    ('saved_searches', 'created_at', 'timestamp with time zone', true),
    ('saved_searches', 'updated_at', 'timestamp with time zone', true),
    ('businesses', 'id', 'uuid', true),
    ('businesses', 'slug', 'character varying(300)', true),
    ('businesses', 'name', 'character varying(255)', true),
    ('businesses', 'legal_name', 'character varying(255)', false),
    ('businesses', 'status', 'business_status', true),
    ('businesses', 'industry_id', 'uuid', false),
    ('businesses', 'category_id', 'uuid', false),
    ('businesses', 'business_type_id', 'uuid', false),
    ('businesses', 'business_type', 'business_type_enum', false),
    ('businesses', 'msme_category_id', 'uuid', false),
    ('businesses', 'msme_category', 'msme_category_enum', false),
    ('businesses', 'opportunity_tier', 'business_opportunity_tier', true),
    ('businesses', 'employee_count_range', 'character varying(50)', false),
    ('businesses', 'annual_revenue_range', 'character varying(50)', false),
    ('businesses', 'founding_year', 'integer', false),
    ('businesses', 'incorporation_date', 'timestamp with time zone', false),
    ('businesses', 'description', 'text', false),
    ('businesses', 'logo_url', 'text', false),
    ('businesses', 'banner_url', 'text', false),
    ('businesses', 'is_enriched', 'boolean', true),
    ('businesses', 'is_verified', 'boolean', true),
    ('businesses', 'last_enriched_at', 'timestamp with time zone', false),
    ('businesses', 'source_id', 'uuid', false),
    ('businesses', 'metadata', 'jsonb', false),
    ('businesses', 'published_at', 'timestamp with time zone', false),
    ('businesses', 'created_at', 'timestamp with time zone', true),
    ('businesses', 'updated_at', 'timestamp with time zone', true),
    ('business_history', 'id', 'uuid', true),
    ('business_history', 'business_id', 'uuid', true),
    ('business_history', 'changed_by_id', 'uuid', false),
    ('business_history', 'change_type', 'character varying(100)', true),
    ('business_history', 'field_name', 'character varying(100)', false),
    ('business_history', 'old_value', 'text', false),
    ('business_history', 'new_value', 'text', false),
    ('business_history', 'full_snapshot', 'jsonb', true),
    ('business_history', 'change_reason', 'text', false),
    ('business_history', 'source_batch_id', 'uuid', false),
    ('business_history', 'changed_at', 'timestamp with time zone', true),
    ('duplicate_clusters', 'id', 'uuid', true),
    ('duplicate_clusters', 'cluster_key', 'character varying(255)', true),
    ('duplicate_clusters', 'primary_business_id', 'uuid', false),
    ('duplicate_clusters', 'total_candidates', 'integer', true),
    ('duplicate_clusters', 'status', 'character varying(50)', true),
    ('duplicate_clusters', 'resolved_action', 'review_action_enum', false),
    ('duplicate_clusters', 'resolved_by_id', 'uuid', false),
    ('duplicate_clusters', 'resolved_at', 'timestamp with time zone', false),
    ('duplicate_clusters', 'created_at', 'timestamp with time zone', true)
),
actual AS (
  SELECT c.relname::text                        AS tbl,
         a.attname::text                        AS col,
         format_type(a.atttypid, a.atttypmod)   AS typ,
         a.attnotnull                           AS not_null,
         a.atthasdef                            AS has_default
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND c.relname IN ('import_batches', 'users', 'credit_transactions', 'saved_searches', 'businesses', 'business_history', 'duplicate_clusters')
    AND a.attnum > 0
    AND NOT a.attisdropped
),
joined AS (
  SELECT COALESCE(e.tbl, a.tbl) AS tbl,
         COALESCE(e.col, a.col) AS col,
         CASE
           WHEN a.col IS NULL                          THEN 'MISSING_IN_DB'
           WHEN e.col IS NULL                          THEN 'EXTRA_IN_DB'
           WHEN e.typ <> a.typ                         THEN 'TYPE_DIFFERS'
           WHEN e.not_null AND NOT a.not_null          THEN 'NULLABLE_BUT_EXPECTED_NOT_NULL'
           WHEN NOT e.not_null AND a.not_null          THEN 'NOT_NULL_BUT_EXPECTED_NULLABLE'
           ELSE 'OK'
         END AS finding,
         e.typ AS expected_type, a.typ AS actual_type, e.not_null AS expected_not_null, a.not_null AS actual_not_null, a.has_default
  FROM expected e
  FULL OUTER JOIN actual a ON a.tbl = e.tbl AND a.col = e.col
)
SELECT 'C05' AS check_id, tbl, col, finding, expected_type, actual_type, expected_not_null, actual_not_null, has_default
FROM joined
WHERE finding <> 'OK'
ORDER BY tbl, finding, col;
WITH expected(tbl, col, typ, not_null) AS (
  VALUES
    ('import_batches', 'id', 'uuid', true),
    ('import_batches', 'source_id', 'uuid', false),
    ('import_batches', 'created_by_id', 'uuid', false),
    ('import_batches', 'filename', 'character varying(255)', true),
    ('import_batches', 'file_key', 'text', true),
    ('import_batches', 'file_size', 'integer', true),
    ('import_batches', 'mime_type', 'character varying(100)', true),
    ('import_batches', 'status', 'import_status', true),
    ('import_batches', 'total_records', 'integer', true),
    ('import_batches', 'processed_records', 'integer', true),
    ('import_batches', 'successful_records', 'integer', true),
    ('import_batches', 'failed_records', 'integer', true),
    ('import_batches', 'duplicate_records', 'integer', true),
    ('import_batches', 'mapping_config', 'jsonb', true),
    ('import_batches', 'options', 'jsonb', true),
    ('import_batches', 'error_message', 'text', false),
    ('import_batches', 'people_summary', 'jsonb', false),
    ('import_batches', 'started_at', 'timestamp with time zone', false),
    ('import_batches', 'completed_at', 'timestamp with time zone', false),
    ('import_batches', 'created_at', 'timestamp with time zone', true),
    ('import_batches', 'updated_at', 'timestamp with time zone', true),
    ('users', 'id', 'uuid', true),
    ('users', 'email', 'character varying(255)', true),
    ('users', 'password_hash', 'character varying(255)', false),
    ('users', 'first_name', 'character varying(100)', true),
    ('users', 'last_name', 'character varying(100)', true),
    ('users', 'display_name', 'character varying(200)', false),
    ('users', 'role', 'user_role', true),
    ('users', 'status', 'user_status', true),
    ('users', 'provider', 'character varying(50)', true),
    ('users', 'provider_id', 'character varying(255)', false),
    ('users', 'google_id', 'character varying(255)', false),
    ('users', 'microsoft_id', 'character varying(255)', false),
    ('users', 'avatar_url', 'text', false),
    ('users', 'profile_picture', 'text', false),
    ('users', 'phone_number', 'character varying(50)', false),
    ('users', 'organization_id', 'uuid', false),
    ('users', 'organization_name', 'character varying(255)', false),
    ('users', 'is_email_verified', 'boolean', true),
    ('users', 'email_verified_at', 'timestamp with time zone', false),
    ('users', 'two_factor_enabled', 'boolean', true),
    ('users', 'two_factor_secret', 'text', false),
    ('users', 'metadata', 'jsonb', false),
    ('users', 'last_login_provider', 'character varying(50)', false),
    ('users', 'last_login_at', 'timestamp with time zone', false),
    ('users', 'created_at', 'timestamp with time zone', true),
    ('users', 'updated_at', 'timestamp with time zone', true),
    ('credit_transactions', 'id', 'uuid', true),
    ('credit_transactions', 'wallet_id', 'uuid', true),
    ('credit_transactions', 'user_id', 'uuid', true),
    ('credit_transactions', 'amount', 'integer', true),
    ('credit_transactions', 'balance_after', 'integer', true),
    ('credit_transactions', 'balance_type', 'character varying(50)', false),
    ('credit_transactions', 'daily_balance_after', 'integer', false),
    ('credit_transactions', 'purchased_balance_after', 'integer', false),
    ('credit_transactions', 'type', 'credit_transaction_type', true),
    ('credit_transactions', 'description', 'character varying(255)', true),
    ('credit_transactions', 'reference_id', 'character varying(255)', false),
    ('credit_transactions', 'metadata', 'jsonb', false),
    ('credit_transactions', 'created_at', 'timestamp with time zone', true),
    ('saved_searches', 'id', 'uuid', true),
    ('saved_searches', 'user_id', 'uuid', true),
    ('saved_searches', 'name', 'character varying(150)', true),
    ('saved_searches', 'filters', 'jsonb', true),
    ('saved_searches', 'alert_enabled', 'boolean', true),
    ('saved_searches', 'alert_frequency', 'character varying(50)', true),
    ('saved_searches', 'last_alert_sent_at', 'timestamp with time zone', false),
    ('saved_searches', 'created_at', 'timestamp with time zone', true),
    ('saved_searches', 'updated_at', 'timestamp with time zone', true),
    ('businesses', 'id', 'uuid', true),
    ('businesses', 'slug', 'character varying(300)', true),
    ('businesses', 'name', 'character varying(255)', true),
    ('businesses', 'legal_name', 'character varying(255)', false),
    ('businesses', 'status', 'business_status', true),
    ('businesses', 'industry_id', 'uuid', false),
    ('businesses', 'category_id', 'uuid', false),
    ('businesses', 'business_type_id', 'uuid', false),
    ('businesses', 'business_type', 'business_type_enum', false),
    ('businesses', 'msme_category_id', 'uuid', false),
    ('businesses', 'msme_category', 'msme_category_enum', false),
    ('businesses', 'opportunity_tier', 'business_opportunity_tier', true),
    ('businesses', 'employee_count_range', 'character varying(50)', false),
    ('businesses', 'annual_revenue_range', 'character varying(50)', false),
    ('businesses', 'founding_year', 'integer', false),
    ('businesses', 'incorporation_date', 'timestamp with time zone', false),
    ('businesses', 'description', 'text', false),
    ('businesses', 'logo_url', 'text', false),
    ('businesses', 'banner_url', 'text', false),
    ('businesses', 'is_enriched', 'boolean', true),
    ('businesses', 'is_verified', 'boolean', true),
    ('businesses', 'last_enriched_at', 'timestamp with time zone', false),
    ('businesses', 'source_id', 'uuid', false),
    ('businesses', 'metadata', 'jsonb', false),
    ('businesses', 'published_at', 'timestamp with time zone', false),
    ('businesses', 'created_at', 'timestamp with time zone', true),
    ('businesses', 'updated_at', 'timestamp with time zone', true),
    ('business_history', 'id', 'uuid', true),
    ('business_history', 'business_id', 'uuid', true),
    ('business_history', 'changed_by_id', 'uuid', false),
    ('business_history', 'change_type', 'character varying(100)', true),
    ('business_history', 'field_name', 'character varying(100)', false),
    ('business_history', 'old_value', 'text', false),
    ('business_history', 'new_value', 'text', false),
    ('business_history', 'full_snapshot', 'jsonb', true),
    ('business_history', 'change_reason', 'text', false),
    ('business_history', 'source_batch_id', 'uuid', false),
    ('business_history', 'changed_at', 'timestamp with time zone', true),
    ('duplicate_clusters', 'id', 'uuid', true),
    ('duplicate_clusters', 'cluster_key', 'character varying(255)', true),
    ('duplicate_clusters', 'primary_business_id', 'uuid', false),
    ('duplicate_clusters', 'total_candidates', 'integer', true),
    ('duplicate_clusters', 'status', 'character varying(50)', true),
    ('duplicate_clusters', 'resolved_action', 'review_action_enum', false),
    ('duplicate_clusters', 'resolved_by_id', 'uuid', false),
    ('duplicate_clusters', 'resolved_at', 'timestamp with time zone', false),
    ('duplicate_clusters', 'created_at', 'timestamp with time zone', true)
),
actual AS (
  SELECT c.relname::text AS tbl, a.attname::text AS col
  FROM pg_attribute a
  JOIN pg_class c     ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND c.relname IN ('import_batches', 'users', 'credit_transactions', 'saved_searches', 'businesses', 'business_history', 'duplicate_clusters')
    AND a.attnum > 0 AND NOT a.attisdropped
)
SELECT 'C05b' AS check_id,
       COALESCE(e.tbl, a.tbl)                         AS tbl,
       count(*) FILTER (WHERE e.col IS NOT NULL)::int AS expected_columns,
       count(*) FILTER (WHERE a.col IS NOT NULL)::int AS actual_columns
FROM expected e
FULL OUTER JOIN actual a ON a.tbl = e.tbl AND a.col = e.col
GROUP BY COALESCE(e.tbl, a.tbl)
ORDER BY 2;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C06  import_batches: indexes and constraints (structure only)
--   Orion's expected index names: 'import_batches_status_idx', 'import_batches_source_idx', 'import_batches_created_by_idx', 'import_batches_created_at_idx'.
--   The pipeline's migration 003 expects: idx_import_batches_active_checksum (UNIQUE, partial on processing_status IN
--   ('PROCESSING','COMPLETED')), idx_import_batches_sha256, idx_import_batches_r2_key, idx_import_batches_status,
--   idx_import_batches_created_at, and the foreign key fk_import_logs_batch (import_logs.batch_id).
--   The definition tails contain column names and, for partial indexes, status literals. No data. Exposure: low.
--   ELEVATED: no. Interpretation: a missing active-checksum index means the pipeline's duplicate protection is not in force.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C06a' AS check_id,
       i.indexname,
       CASE
         WHEN i.indexname IN ('import_batches_status_idx', 'import_batches_source_idx', 'import_batches_created_by_idx', 'import_batches_created_at_idx') THEN 'orion_expected'
         WHEN i.indexname IN ('idx_import_batches_active_checksum', 'idx_import_batches_sha256', 'idx_import_batches_r2_key', 'idx_import_batches_status', 'idx_import_batches_created_at') THEN 'pipeline_expected'
         WHEN i.indexname = 'import_batches_pkey' THEN 'primary_key'
         ELSE 'unexpected'
       END AS origin,
       (i.indexdef ILIKE 'CREATE UNIQUE%')                    AS is_unique,
       regexp_replace(i.indexdef, '^.* USING ', '')           AS definition_tail
FROM pg_indexes i
WHERE i.schemaname = 'public' AND i.tablename = 'import_batches'
ORDER BY 2;
SELECT 'C06b' AS check_id,
       c.conname,
       c.contype::text                                        AS contype,   -- p primary, f foreign, u unique, c check
       pg_get_constraintdef(c.oid)                            AS definition
FROM pg_constraint c
WHERE c.conrelid = to_regclass('public.import_batches')
ORDER BY 2;
SELECT 'C06c' AS check_id,
       c.conrelid::regclass::text                             AS referencing_table,
       c.conname,
       c.confdeltype::text                                    AS on_delete,   -- a no action, r restrict, c cascade, n set null, d set default
       pg_get_constraintdef(c.oid)                            AS definition
FROM pg_constraint c
WHERE c.confrelid = to_regclass('public.import_batches') AND c.contype = 'f'
ORDER BY 2, 3;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C07  Enumerated types the two systems share or compare (labels only)
--   import_status (Orion batch status) is compared with the pipeline's separate processing_status (a plain varchar).
--   Exposure: enum labels (none). ELEVATED: no.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C07' AS check_id, n.nspname AS schema_name, t.typname AS type_name, e.enumsortorder AS sort_order, e.enumlabel AS label
FROM pg_type t
JOIN pg_enum e      ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typname IN ('import_status', 'user_role', 'user_status', 'person_verification_status', 'data_source_type')
ORDER BY 3, 4;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C08  import_batches: aggregate field-contract evidence. NO row values: only counts, classes and UTC timestamps.
--   C08a  status (Orion enum) x processing_status (pipeline varchar): counts, key presence/equality, URI/key consistency.
--   C08b  classes of file_key / r2_object_key (prefix class only) and r2_uri scheme (matched scheme only, never the URI).
--         The scheme extraction is guarded: a value that does not start with a known scheme prints as '<other>' instead of
--         being echoed (a naive split_part(r2_uri, '://', 1) would print the whole URI, including the object key, for
--         malformed values).
--   C08c  checksum shape and duplicate groups (counts only).
--   C08d  counter columns: Orion's *_records versus the pipeline's *_rows on pipeline-origin batches.
--   Exposure: counts and timestamps only. Small groups (n = 1) describe a batch, not a person. ELEVATED: no.
--   If any referenced column does not exist (42703) the pipeline's columns are absent: record it and skip the rest of C08.
--   Interpretation limits: equality of file_key and r2_object_key on some rows is NOT proof of semantic equivalence.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C08a' AS check_id,
       b.status::text                                                                                         AS status,
       b.processing_status,
       count(*)::int                                                                                          AS batches,
       count(*) FILTER (WHERE b.file_key IS NULL)::int                                                        AS file_key_null,
       count(*) FILTER (WHERE b.r2_object_key IS NULL)::int                                                   AS r2_object_key_null,
       count(*) FILTER (WHERE b.file_key IS NOT NULL AND b.r2_object_key IS NOT NULL AND b.file_key = b.r2_object_key)::int AS keys_equal,
       count(*) FILTER (WHERE b.file_key IS NOT NULL AND b.r2_object_key IS NOT NULL AND b.file_key <> b.r2_object_key)::int AS keys_differ,
       count(*) FILTER (WHERE b.r2_uri IS NOT NULL AND b.r2_object_key IS NOT NULL AND right(b.r2_uri, length(b.r2_object_key)) = b.r2_object_key)::int AS uri_ends_with_key,
       min(b.created_at) AT TIME ZONE 'UTC'                                                                   AS first_created_utc,
       max(b.created_at) AT TIME ZONE 'UTC'                                                                   AS last_created_utc
FROM public.import_batches b
GROUP BY b.status::text, b.processing_status
ORDER BY 2, 3;
SELECT 'C08b' AS check_id,
       CASE WHEN b.file_key IS NULL THEN 'NULL'
            WHEN b.file_key LIKE 'imports/%' THEN 'imports/'
            WHEN b.file_key LIKE 'raw/%' THEN 'raw/'
            ELSE '<other>' END                                                                                AS file_key_class,
       CASE WHEN b.r2_object_key IS NULL THEN 'NULL'
            WHEN b.r2_object_key LIKE 'raw/%' THEN 'raw/'
            WHEN b.r2_object_key LIKE 'imports/%' THEN 'imports/'
            ELSE '<other>' END                                                                                AS r2_object_key_class,
       CASE WHEN b.r2_uri IS NULL THEN 'NULL'
            WHEN b.r2_uri ~ '^(r2|local-r2|s3|https?)://' THEN substring(b.r2_uri from '^[a-z0-9-]+')
            ELSE '<other>' END                                                                                AS r2_uri_scheme,
       count(*)::int                                                                                          AS batches
FROM public.import_batches b
GROUP BY 2, 3, 4
ORDER BY 2, 3, 4;
SELECT 'C08c' AS check_id,
       count(*) FILTER (WHERE b.sha256_checksum IS NOT NULL)::int                                              AS rows_with_checksum,
       count(DISTINCT b.sha256_checksum)::int                                                                  AS distinct_checksums,
       count(*) FILTER (WHERE b.sha256_checksum IS NOT NULL AND b.sha256_checksum !~ '^[0-9a-f]{64}$')::int    AS not_sha256_shaped
FROM public.import_batches b;
SELECT 'C08c2' AS check_id, g.copies, count(*)::int AS checksum_groups
FROM (SELECT sha256_checksum, count(*) AS copies FROM public.import_batches WHERE sha256_checksum IS NOT NULL GROUP BY sha256_checksum) g
GROUP BY g.copies
ORDER BY g.copies;
SELECT 'C08d' AS check_id,
       b.processing_status,
       count(*)::int                                                                                           AS batches,
       count(*) FILTER (WHERE b.total_rows IS DISTINCT FROM b.total_records)::int                              AS total_rows_vs_records_differ,
       count(*) FILTER (WHERE b.successful_rows IS DISTINCT FROM b.successful_records)::int                    AS successful_differ,
       count(*) FILTER (WHERE b.failed_rows IS DISTINCT FROM b.failed_records)::int                            AS failed_differ
FROM public.import_batches b
WHERE b.r2_object_key IS NOT NULL
GROUP BY b.processing_status
ORDER BY 2;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C09  Activity evidence for the pipeline's tables and the shared tables (estimates and aggregates)
--   C09a  pg_stat_user_tables counters. These are cumulative since the last statistics reset and can be reset by a compute
--         restart (Neon scale-to-zero), so a low or zero counter is NOT proof of inactivity. n_live_tup is an estimate.
--   C09b  pipeline_jobs aggregates by type and status (no payloads, no worker ids: only a distinct count).
--   C09c  execution_logs: counts by level and newest timestamp (messages, entity names and file names are NOT selected).
--   C09d  newest timestamps on shared tables. Timestamps say that SOMETHING wrote, not WHO.
--   Exposure: counts and timestamps (none to low). ELEVATED: no.
--   Interpretation limit: none of this identifies a running process; it only dates the last write.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C09a' AS check_id, relname, n_live_tup, n_tup_ins, n_tup_upd, n_tup_del,
       (last_autovacuum AT TIME ZONE 'UTC') AS last_autovacuum_utc, (last_autoanalyze AT TIME ZONE 'UTC') AS last_autoanalyze_utc
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND relname IN ('import_batches', 'import_logs', 'pipeline_jobs', 'execution_logs', 'businesses', 'users', 'credit_transactions',
                  'saved_searches', 'business_history', 'duplicate_clusters', 'accounts', 'user_sessions', 'unlocked_leads', 'master_businesses')
ORDER BY 2;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C09b' AS check_id,
       j.job_type, j.status,
       count(*)::int                                          AS jobs,
       (min(j.created_at) AT TIME ZONE 'UTC')                 AS first_created_utc,
       (max(j.created_at) AT TIME ZONE 'UTC')                 AS last_created_utc,
       (max(j.updated_at) AT TIME ZONE 'UTC')                 AS last_updated_utc,
       (max(j.last_heartbeat_at) AT TIME ZONE 'UTC')          AS last_heartbeat_utc,
       count(DISTINCT j.worker_id)::int                       AS distinct_workers
FROM public.pipeline_jobs j
GROUP BY j.job_type, j.status
ORDER BY 2, 3;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C09c' AS check_id, l.level, count(*)::int AS log_rows, (max(l.created_at) AT TIME ZONE 'UTC') AS newest_utc
FROM public.execution_logs l
GROUP BY l.level
ORDER BY 2;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C09d' AS check_id, 'businesses' AS table_name, count(*)::int AS rows_total,
       (max(created_at) AT TIME ZONE 'UTC') AS newest_created_utc, (max(updated_at) AT TIME ZONE 'UTC') AS newest_updated_utc
FROM public.businesses
UNION ALL
SELECT 'C09d', 'users', count(*)::int, (max(created_at) AT TIME ZONE 'UTC'), (max(updated_at) AT TIME ZONE 'UTC')
FROM public.users
UNION ALL
SELECT 'C09d', 'credit_transactions', count(*)::int, (max(created_at) AT TIME ZONE 'UTC'), NULL
FROM public.credit_transactions;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C10  Current connections to this database (aggregated, no query text, no addresses)
--   ELEVATED: pg_read_all_stats (or pg_monitor / superuser). Without it PostgreSQL blanks datname, usename, state and the
--   other columns of sessions that belong to other roles, so a naive "WHERE datname = current_database()" would silently
--   show NOTHING and look like "no other connections". C10a therefore counts the blanked sessions explicitly.
--   Exposure: role names, application names, session start times. The query text, client_addr, client_hostname and client_port
--   columns are intentionally not selected.
--   Interpretation: only if can_read_all_stats (C00) is true and hidden_client_sessions is 0 can the rows be read as "who is
--   connected right now". A pooled (-pooler) endpoint hides which application connected: use the direct endpoint.
--   Limit: a snapshot of one second; a periodic worker may connect only briefly. Not proof that nothing runs.
--   STOP if hidden_client_sessions > 0: report that session visibility is incomplete, do not conclude.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C10a' AS check_id,
       count(*)::int                                                                   AS all_sessions,
       count(*) FILTER (WHERE backend_type = 'client backend')::int                    AS client_sessions,
       count(*) FILTER (WHERE backend_type = 'client backend' AND datname IS NULL)::int AS hidden_client_sessions,
       count(*) FILTER (WHERE pid = pg_backend_pid())::int                             AS this_session
FROM pg_stat_activity;
SELECT 'C10b' AS check_id,
       a.usename                                         AS role_name,
       COALESCE(NULLIF(a.application_name, ''), '(none)') AS application_name,
       a.state,
       count(*)::int                                     AS sessions,
       (min(a.backend_start) AT TIME ZONE 'UTC')         AS oldest_session_start_utc,
       (max(a.state_change) AT TIME ZONE 'UTC')          AS latest_state_change_utc
FROM pg_stat_activity a
WHERE a.datname = current_database()
  AND a.backend_type = 'client backend'
  AND a.pid <> pg_backend_pid()
GROUP BY a.usename, COALESCE(NULLIF(a.application_name, ''), '(none)'), a.state
ORDER BY 2, 3, 4;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C11  Roles, memberships, ownership and grants (names and counts; the privilege picture for the least-privilege design)
--   C11a  existing login/non-login roles and attributes (pg_roles never shows passwords; pg_authid is deliberately NOT used,
--         it needs superuser and holds password hashes).
--   C11b  role memberships (non-internal).
--   C11c  explicit grants aggregated by schema, relation kind, owner, grantee and privilege. A relation whose ACL is NULL has
--         only the default (owner) privileges and does not appear here: C11d counts those.
--   C11e  default privileges, C11f schema ACLs, C11g database ACL.
--   Exposure: role names and ACL strings (low; no credentials). ELEVATED: no (all world-readable catalogues).
--   Limit: Neon manages some roles itself (names such as neon_superuser); do not treat them as application roles.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C11a' AS check_id, rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolconnlimit
FROM pg_roles
WHERE rolname !~ '^pg_'
ORDER BY 2;
SELECT 'C11b' AS check_id, pg_get_userbyid(m.roleid) AS role_name, pg_get_userbyid(m.member) AS member_name, m.admin_option
FROM pg_auth_members m
WHERE pg_get_userbyid(m.member) !~ '^pg_'
ORDER BY 2, 3;
SELECT 'C11c' AS check_id,
       n.nspname                                              AS schema_name,
       c.relkind::text                                        AS relkind,
       pg_get_userbyid(c.relowner)                            AS owner,
       CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
       x.privilege_type,
       count(*)::int                                          AS relations
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(c.relacl) AS x
WHERE n.nspname IN ('public', 'drizzle', 'orion_pipeline')
  AND c.relkind IN ('r', 'p', 'v', 'm')
  AND c.relacl IS NOT NULL
GROUP BY n.nspname, c.relkind, pg_get_userbyid(c.relowner), CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END, x.privilege_type
ORDER BY 2, 3, 4, 5, 6;
SELECT 'C11d' AS check_id, n.nspname AS schema_name, c.relkind::text AS relkind, pg_get_userbyid(c.relowner) AS owner, count(*)::int AS relations_with_default_acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'drizzle', 'orion_pipeline') AND c.relkind IN ('r', 'p', 'v', 'm') AND c.relacl IS NULL
GROUP BY n.nspname, c.relkind, pg_get_userbyid(c.relowner)
ORDER BY 2, 3, 4;
SELECT 'C11e' AS check_id, pg_get_userbyid(d.defaclrole) AS for_role, d.defaclnamespace::regnamespace::text AS in_schema, d.defaclobjtype::text AS object_type, d.defaclacl::text AS acl
FROM pg_default_acl d
ORDER BY 2, 3, 4;
SELECT 'C11f' AS check_id, nspname AS schema_name, pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl
FROM pg_namespace
WHERE nspname IN ('public', 'drizzle', 'orion_pipeline')
ORDER BY 2;
SELECT 'C11g' AS check_id, datname AS database_name, pg_get_userbyid(datdba) AS owner, datacl::text AS acl
FROM pg_database
WHERE datname = current_database();
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C12  Views and what depends on the pipeline's published-businesses view (names only)
--   pg_views.definition and pg_get_viewdef are NOT selected: view bodies are SQL text (they can embed business rules and
--   literals). The pipeline's migrations rebuild orion_published_businesses with DROP VIEW ... CASCADE, which silently drops
--   every view that depends on it; C12b lists those dependents.
--   Exposure: view names and owners (none). ELEVATED: no.
--   Interpretation: C12b rows owned by the Orion side mean a pipeline migration run could remove an Orion dependency.
--   If public.orion_published_businesses does not exist (C04) C12b returns no rows and says nothing.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C12a' AS check_id, schemaname AS schema_name, viewname, viewowner
FROM pg_views
WHERE schemaname NOT LIKE 'pg\_%' AND schemaname <> 'information_schema'
ORDER BY 2, 3;
SELECT 'C12b' AS check_id,
       dn.nspname                         AS dependent_schema,
       dv.relname                         AS dependent_view,
       dv.relkind::text                   AS relkind,
       pg_get_userbyid(dv.relowner)       AS dependent_owner
FROM pg_depend d
JOIN pg_rewrite r      ON r.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
JOIN pg_class dv       ON dv.oid = r.ev_class
JOIN pg_namespace dn   ON dn.oid = dv.relnamespace
WHERE d.refobjid = to_regclass('public.orion_published_businesses')
  AND dv.oid <> d.refobjid
GROUP BY dn.nspname, dv.relname, dv.relkind, dv.relowner
ORDER BY 2, 3;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C13  Cross-system user and ledger shape (counts and ranges only; no ids, emails, names or amounts)
--   C13a  distribution of users.role values and creation range. A value the Orion role enum does not contain ('customer')
--         would indicate pipeline-originated users; an enum column cannot hold it, which is itself informative.
--   C13b  credit_transactions provenance: how many rows carry the pipeline-only columns (account_id, transaction_type).
--   C13c  size of the pipeline's accounts table.
--   Exposure: counts only. Customer identities are not selected. ELEVATED: no.
--   If a column does not exist (42703) record it: it means that pipeline column was never added.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C13a' AS check_id, u.role::text AS role_value, count(*)::int AS users,
       (min(u.created_at) AT TIME ZONE 'UTC') AS first_created_utc, (max(u.created_at) AT TIME ZONE 'UTC') AS last_created_utc
FROM public.users u
GROUP BY u.role::text
ORDER BY 2;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C13b' AS check_id,
       count(*)::int                                                  AS ledger_rows,
       count(*) FILTER (WHERE t.account_id IS NOT NULL)::int          AS with_account_id,
       count(*) FILTER (WHERE t.transaction_type IS NOT NULL)::int    AS with_transaction_type
FROM public.credit_transactions t;
ROLLBACK;
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C13c' AS check_id, count(*)::int AS accounts_rows FROM public.accounts;
ROLLBACK;


-- ---------------------------------------------------------------------------------------------------------------------
-- C14  Publication-state contract evidence for businesses (aggregates only)
--   Owner decision under verification: Orion's businesses.status is the intended publication authority. The pipeline keeps its
--   own publishing_status / stage (columns the Orion schema does not define). This check cross-tabulates both so the contract
--   can be verified from data: do the two ever disagree, and which one has been driving published_at?
--   C14a  counts by (status, publishing_status, stage) with published_at / unpublished_at presence.
--   C14b  explicit disagreement counts in both directions.
--   Exposure: counts only; no business names, slugs or ids. ELEVATED: no (needs SELECT on businesses).
--   42703 on publishing_status / stage / unpublished_at means the pipeline's columns are absent: record it.
--   Limit: agreement today does not prove which system writes which flag.
-- ---------------------------------------------------------------------------------------------------------------------
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT 'C14a' AS check_id,
       b.status::text                                                   AS orion_status,
       b.publishing_status                                              AS pipeline_publishing_status,
       b.stage                                                          AS pipeline_stage,
       count(*)::int                                                    AS businesses,
       count(*) FILTER (WHERE b.published_at IS NOT NULL)::int          AS with_published_at,
       count(*) FILTER (WHERE b.unpublished_at IS NOT NULL)::int        AS with_unpublished_at
FROM public.businesses b
GROUP BY b.status::text, b.publishing_status, b.stage
ORDER BY 2, 3, 4;
SELECT 'C14b' AS check_id,
       count(*) FILTER (WHERE b.status::text = 'PUBLISHED' AND b.publishing_status IS DISTINCT FROM 'PUBLISHED')::int  AS orion_published_pipeline_not,
       count(*) FILTER (WHERE b.publishing_status = 'PUBLISHED' AND b.status::text IS DISTINCT FROM 'PUBLISHED')::int  AS pipeline_published_orion_not,
       count(*) FILTER (WHERE b.status::text = 'PUBLISHED' AND b.publishing_status = 'PUBLISHED')::int                  AS both_published
FROM public.businesses b;
ROLLBACK;

-- END OF FILE. Nothing above writes anything; if a client opened an implicit transaction, ROLLBACK again before disconnecting.
