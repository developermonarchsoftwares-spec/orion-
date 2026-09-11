CREATE TYPE "public"."business_opportunity_tier" AS ENUM('HIGH', 'MEDIUM', 'LOW', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('DRAFT', 'PENDING_VALIDATION', 'VERIFIED', 'PUBLISHED', 'ARCHIVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."business_type_enum" AS ENUM('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'LLP', 'PROPRIETORSHIP', 'PARTNERSHIP', 'OPC', 'FOREIGN_COMPANY', 'TRUST', 'SOCIETY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('PURCHASE', 'UNLOCK_LEAD', 'EXPORT_DATA', 'REFUND', 'ADMIN_ADJUSTMENT', 'BONUS');--> statement-breakpoint
CREATE TYPE "public"."data_source_type" AS ENUM('GOVERNMENT_REGISTRY', 'WEB_SCRAPING', 'MANUAL_IMPORT', 'API_INTEGRATION', 'USER_SUBMISSION', 'PARTNER_FEED');--> statement-breakpoint
CREATE TYPE "public"."digital_platform_enum" AS ENUM('WEBSITE', 'LINKEDIN', 'TWITTER', 'FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'GITHUB', 'CRUNCHBASE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."duplicate_match_type_enum" AS ENUM('EXACT', 'IDENTIFIER', 'FUZZY_NAME', 'LOCATION');--> statement-breakpoint
CREATE TYPE "public"."identifier_type_enum" AS ENUM('CIN', 'GSTIN', 'PAN', 'UDYAM', 'LEI', 'TAN', 'REG_NO', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."import_record_status_enum" AS ENUM('PENDING', 'NORMALIZED', 'VALIDATED', 'FLAGGED_DUPLICATE', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'MERGED', 'PUBLISHED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('PENDING', 'PARSING', 'PROCESSING', 'ENRICHING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."msme_category_enum" AS ENUM('MICRO', 'SMALL', 'MEDIUM', 'ENTERPRISE', 'NOT_APPLICABLE');--> statement-breakpoint
CREATE TYPE "public"."review_action_enum" AS ENUM('APPROVE', 'REJECT', 'MERGE', 'EDIT', 'PUBLISH');--> statement-breakpoint
CREATE TYPE "public"."search_sync_status_enum" AS ENUM('PENDING', 'SYNCED', 'FAILED', 'RETRYING');--> statement-breakpoint
CREATE TYPE "public"."storage_provider_type" AS ENUM('s3', 'r2', 'minio', 'local');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('SUPER_ADMIN', 'ADMIN', 'DATA_MANAGER', 'MEMBER', 'USER');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');--> statement-breakpoint
CREATE TYPE "public"."validation_severity_enum" AS ENUM('ERROR', 'WARNING', 'INFO');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"scopes" jsonb DEFAULT '["read"]'::jsonb NOT NULL,
	"rate_limit" jsonb DEFAULT '{"limit":100,"ttl":60}'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"family_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"user_agent" text,
	"ip_address" varchar(45),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"avatar_url" text,
	"phone_number" varchar(50),
	"organization_id" uuid,
	"organization_name" varchar(255),
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"two_factor_secret" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"legal_form" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry_id" uuid,
	"name" varchar(150) NOT NULL,
	"slug" varchar(150) NOT NULL,
	"code" varchar(50),
	"description" text,
	"icon_name" varchar(50),
	"business_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(150) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"business_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "msme_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"investment_limit_max" integer,
	"turnover_limit_max" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(300) NOT NULL,
	"name" varchar(255) NOT NULL,
	"legal_name" varchar(255),
	"status" "business_status" DEFAULT 'DRAFT' NOT NULL,
	"industry_id" uuid,
	"category_id" uuid,
	"business_type_id" uuid,
	"business_type" "business_type_enum" DEFAULT 'PRIVATE_LIMITED',
	"msme_category_id" uuid,
	"msme_category" "msme_category_enum" DEFAULT 'NOT_APPLICABLE',
	"opportunity_tier" "business_opportunity_tier" DEFAULT 'LOW' NOT NULL,
	"employee_count_range" varchar(50),
	"annual_revenue_range" varchar(50),
	"founding_year" integer,
	"incorporation_date" timestamp with time zone,
	"description" text,
	"logo_url" text,
	"banner_url" text,
	"is_enriched" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"last_enriched_at" timestamp with time zone,
	"source_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"full_name" varchar(150) NOT NULL,
	"title" varchar(150),
	"department" varchar(100),
	"email" varchar(255),
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"phone" varchar(50),
	"is_phone_verified" boolean DEFAULT false NOT NULL,
	"is_direct_dial" boolean DEFAULT false NOT NULL,
	"linkedin_url" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_decision_maker" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"changed_by_id" uuid,
	"change_type" varchar(100) NOT NULL,
	"field_name" varchar(100),
	"old_value" text,
	"new_value" text,
	"full_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"change_reason" text,
	"source_batch_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" "identifier_type_enum" NOT NULL,
	"value" varchar(100) NOT NULL,
	"normalized_value" varchar(100) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"landmark" varchar(255),
	"city" varchar(100) NOT NULL,
	"district" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"pincode" varchar(20) NOT NULL,
	"country" varchar(100) DEFAULT 'India' NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"is_primary" boolean DEFAULT true NOT NULL,
	"is_registered_office" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"completeness_score" integer DEFAULT 0 NOT NULL,
	"verification_score" integer DEFAULT 0 NOT NULL,
	"freshness_score" integer DEFAULT 0 NOT NULL,
	"digital_presence_score" integer DEFAULT 0 NOT NULL,
	"confidence_score" integer DEFAULT 0 NOT NULL,
	"factor_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_calculated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_refresh_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"triggered_by_id" uuid,
	"source_id" uuid,
	"source_type" varchar(100),
	"fields_updated" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'COMPLETED' NOT NULL,
	"duration_ms" integer,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"orion_score" integer DEFAULT 0 NOT NULL,
	"score_version" varchar(50) DEFAULT 'v1.0' NOT NULL,
	"weights_applied" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digital_presences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"platform" "digital_platform_enum" NOT NULL,
	"handle" varchar(150),
	"url" text NOT NULL,
	"domain" varchar(255),
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"follower_count" integer,
	"tech_stack_detected" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"type" "data_source_type" NOT NULL,
	"description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"total_records_ingested" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"created_by_id" uuid,
	"filename" varchar(255) NOT NULL,
	"file_key" text NOT NULL,
	"file_size" integer NOT NULL,
	"mime_type" varchar(100) DEFAULT 'text/csv' NOT NULL,
	"status" "import_status" DEFAULT 'PENDING' NOT NULL,
	"total_records" integer DEFAULT 0 NOT NULL,
	"processed_records" integer DEFAULT 0 NOT NULL,
	"successful_records" integer DEFAULT 0 NOT NULL,
	"failed_records" integer DEFAULT 0 NOT NULL,
	"duplicate_records" integer DEFAULT 0 NOT NULL,
	"mapping_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{"autoNormalize":true,"autoValidate":true,"autoDetectDuplicates":true}'::jsonb NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" "import_record_status_enum" DEFAULT 'PENDING' NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"normalized_payload" jsonb,
	"error_details" jsonb,
	"target_business_id" uuid,
	"has_duplicates" boolean DEFAULT false NOT NULL,
	"is_reviewed" boolean DEFAULT false NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"rule_name" varchar(100) NOT NULL,
	"field" varchar(100) NOT NULL,
	"severity" "validation_severity_enum" DEFAULT 'ERROR' NOT NULL,
	"message" text NOT NULL,
	"passed" boolean NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"record_id" uuid,
	"matched_business_id" uuid,
	"confidence_score" numeric(5, 2) NOT NULL,
	"match_type" "duplicate_match_type_enum" NOT NULL,
	"match_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"resolved_action" "review_action_enum",
	"resolved_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duplicate_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_key" varchar(255) NOT NULL,
	"primary_business_id" uuid,
	"total_candidates" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"resolved_action" "review_action_enum",
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"target_business_id" uuid,
	"publish_mode" varchar(50) DEFAULT 'CREATE' NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"cluster_id" uuid,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" varchar(50) DEFAULT 'PENDING' NOT NULL,
	"reviewer_id" uuid,
	"decision" "review_action_enum",
	"review_notes" text,
	"edited_payload" jsonb,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"action" varchar(50) DEFAULT 'UPSERT' NOT NULL,
	"status" "search_sync_status_enum" DEFAULT 'PENDING' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"payload_snapshot" jsonb,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"description" varchar(255) NOT NULL,
	"reference_id" varchar(255),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"credits_spent" integer DEFAULT 1 NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetime_purchased" integer DEFAULT 0 NOT NULL,
	"lifetime_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"notes" text,
	"pipeline_stage" varchar(50) DEFAULT 'NEW' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"filters" jsonb NOT NULL,
	"alert_enabled" boolean DEFAULT false NOT NULL,
	"alert_frequency" varchar(50) DEFAULT 'DAILY' NOT NULL,
	"last_alert_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(255),
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_industry_id_industries_id_fk" FOREIGN KEY ("industry_id") REFERENCES "public"."industries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_industry_id_industries_id_fk" FOREIGN KEY ("industry_id") REFERENCES "public"."industries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_business_type_id_business_types_id_fk" FOREIGN KEY ("business_type_id") REFERENCES "public"."business_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_msme_category_id_msme_categories_id_fk" FOREIGN KEY ("msme_category_id") REFERENCES "public"."msme_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_history" ADD CONSTRAINT "business_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_history" ADD CONSTRAINT "business_history_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_identifiers" ADD CONSTRAINT "business_identifiers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_locations" ADD CONSTRAINT "business_locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_metrics" ADD CONSTRAINT "business_metrics_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_refresh_history" ADD CONSTRAINT "business_refresh_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_refresh_history" ADD CONSTRAINT "business_refresh_history_triggered_by_id_users_id_fk" FOREIGN KEY ("triggered_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_scores" ADD CONSTRAINT "business_scores_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digital_presences" ADD CONSTRAINT "digital_presences_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_records" ADD CONSTRAINT "import_records_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_logs" ADD CONSTRAINT "validation_logs_record_id_import_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."import_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_cluster_id_duplicate_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."duplicate_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_record_id_import_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."import_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidates" ADD CONSTRAINT "duplicate_candidates_matched_business_id_businesses_id_fk" FOREIGN KEY ("matched_business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_clusters" ADD CONSTRAINT "duplicate_clusters_primary_business_id_businesses_id_fk" FOREIGN KEY ("primary_business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_clusters" ADD CONSTRAINT "duplicate_clusters_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_queue" ADD CONSTRAINT "publish_queue_record_id_import_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."import_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_queue" ADD CONSTRAINT "publish_queue_target_business_id_businesses_id_fk" FOREIGN KEY ("target_business_id") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_record_id_import_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."import_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_cluster_id_duplicate_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."duplicate_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_sync_logs" ADD CONSTRAINT "search_sync_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_wallet_id_user_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."user_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_unlocks" ADD CONSTRAINT "lead_unlocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_unlocks" ADD CONSTRAINT "lead_unlocks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD CONSTRAINT "user_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_leads" ADD CONSTRAINT "saved_leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_leads" ADD CONSTRAINT "saved_leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_hash_idx" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_types_code_idx" ON "business_types" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "business_types_slug_idx" ON "business_types" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "business_types_name_idx" ON "business_types" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "categories_industry_idx" ON "categories" USING btree ("industry_id");--> statement-breakpoint
CREATE INDEX "categories_name_idx" ON "categories" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "industries_code_idx" ON "industries" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "industries_slug_idx" ON "industries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "industries_parent_idx" ON "industries" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "industries_name_idx" ON "industries" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "msme_categories_code_idx" ON "msme_categories" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "msme_categories_slug_idx" ON "msme_categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_slug_idx" ON "businesses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "businesses_name_idx" ON "businesses" USING btree ("name");--> statement-breakpoint
CREATE INDEX "businesses_legal_name_idx" ON "businesses" USING btree ("legal_name");--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "businesses_industry_idx" ON "businesses" USING btree ("industry_id");--> statement-breakpoint
CREATE INDEX "businesses_category_idx" ON "businesses" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "businesses_business_type_idx" ON "businesses" USING btree ("business_type_id");--> statement-breakpoint
CREATE INDEX "businesses_type_enum_idx" ON "businesses" USING btree ("business_type");--> statement-breakpoint
CREATE INDEX "businesses_msme_category_idx" ON "businesses" USING btree ("msme_category_id");--> statement-breakpoint
CREATE INDEX "businesses_opportunity_tier_idx" ON "businesses" USING btree ("opportunity_tier");--> statement-breakpoint
CREATE INDEX "businesses_created_at_idx" ON "businesses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "businesses_published_at_idx" ON "businesses" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "bus_contacts_business_idx" ON "business_contacts" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_contacts_email_idx" ON "business_contacts" USING btree ("email");--> statement-breakpoint
CREATE INDEX "bus_contacts_phone_idx" ON "business_contacts" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "bus_contacts_decision_maker_idx" ON "business_contacts" USING btree ("is_decision_maker");--> statement-breakpoint
CREATE INDEX "bus_history_business_idx" ON "business_history" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_history_changed_at_idx" ON "business_history" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "bus_history_change_type_idx" ON "business_history" USING btree ("change_type");--> statement-breakpoint
CREATE UNIQUE INDEX "bus_ident_type_norm_val_idx" ON "business_identifiers" USING btree ("type","normalized_value");--> statement-breakpoint
CREATE INDEX "bus_ident_business_idx" ON "business_identifiers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_ident_type_idx" ON "business_identifiers" USING btree ("type");--> statement-breakpoint
CREATE INDEX "bus_ident_val_idx" ON "business_identifiers" USING btree ("value");--> statement-breakpoint
CREATE INDEX "bus_loc_business_idx" ON "business_locations" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_loc_state_idx" ON "business_locations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "bus_loc_district_idx" ON "business_locations" USING btree ("district");--> statement-breakpoint
CREATE INDEX "bus_loc_city_idx" ON "business_locations" USING btree ("city");--> statement-breakpoint
CREATE INDEX "bus_loc_pincode_idx" ON "business_locations" USING btree ("pincode");--> statement-breakpoint
CREATE INDEX "bus_loc_geo_idx" ON "business_locations" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE UNIQUE INDEX "bus_metrics_business_idx" ON "business_metrics" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_metrics_completeness_idx" ON "business_metrics" USING btree ("completeness_score");--> statement-breakpoint
CREATE INDEX "bus_metrics_verification_idx" ON "business_metrics" USING btree ("verification_score");--> statement-breakpoint
CREATE INDEX "bus_refresh_business_idx" ON "business_refresh_history" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_refresh_at_idx" ON "business_refresh_history" USING btree ("refreshed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bus_scores_business_idx" ON "business_scores" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "bus_scores_orion_score_idx" ON "business_scores" USING btree ("orion_score");--> statement-breakpoint
CREATE INDEX "bus_scores_calculated_at_idx" ON "business_scores" USING btree ("calculated_at");--> statement-breakpoint
CREATE INDEX "digital_presence_business_idx" ON "digital_presences" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "digital_presence_platform_idx" ON "digital_presences" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "digital_presence_domain_idx" ON "digital_presences" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "data_sources_type_idx" ON "data_sources" USING btree ("type");--> statement-breakpoint
CREATE INDEX "data_sources_active_idx" ON "data_sources" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "import_batches_status_idx" ON "import_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_batches_source_idx" ON "import_batches" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "import_batches_created_by_idx" ON "import_batches" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "import_batches_created_at_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "import_records_batch_idx" ON "import_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "import_records_status_idx" ON "import_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "import_records_row_num_idx" ON "import_records" USING btree ("row_number");--> statement-breakpoint
CREATE INDEX "import_records_duplicates_idx" ON "import_records" USING btree ("has_duplicates");--> statement-breakpoint
CREATE INDEX "validation_logs_record_idx" ON "validation_logs" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "validation_logs_rule_idx" ON "validation_logs" USING btree ("rule_name");--> statement-breakpoint
CREATE INDEX "validation_logs_severity_idx" ON "validation_logs" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "dup_candidates_cluster_idx" ON "duplicate_candidates" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "dup_candidates_record_idx" ON "duplicate_candidates" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "dup_candidates_matched_bus_idx" ON "duplicate_candidates" USING btree ("matched_business_id");--> statement-breakpoint
CREATE INDEX "dup_candidates_match_type_idx" ON "duplicate_candidates" USING btree ("match_type");--> statement-breakpoint
CREATE INDEX "dup_candidates_confidence_idx" ON "duplicate_candidates" USING btree ("confidence_score");--> statement-breakpoint
CREATE INDEX "dup_clusters_key_idx" ON "duplicate_clusters" USING btree ("cluster_key");--> statement-breakpoint
CREATE INDEX "dup_clusters_primary_bus_idx" ON "duplicate_clusters" USING btree ("primary_business_id");--> statement-breakpoint
CREATE INDEX "dup_clusters_status_idx" ON "duplicate_clusters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publish_queue_record_idx" ON "publish_queue" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "publish_queue_target_bus_idx" ON "publish_queue" USING btree ("target_business_id");--> statement-breakpoint
CREATE INDEX "publish_queue_status_idx" ON "publish_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publish_queue_scheduled_idx" ON "publish_queue" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "review_queue_record_idx" ON "review_queue" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "review_queue_cluster_idx" ON "review_queue" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "review_queue_status_idx" ON "review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "review_queue_priority_idx" ON "review_queue" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "review_queue_reviewer_idx" ON "review_queue" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "search_sync_business_idx" ON "search_sync_logs" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "search_sync_status_idx" ON "search_sync_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "search_sync_created_at_idx" ON "search_sync_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "credit_tx_wallet_idx" ON "credit_transactions" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "credit_tx_user_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_tx_type_idx" ON "credit_transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "credit_tx_created_at_idx" ON "credit_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_unlocks_user_business_idx" ON "lead_unlocks" USING btree ("user_id","business_id");--> statement-breakpoint
CREATE INDEX "lead_unlocks_user_idx" ON "lead_unlocks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lead_unlocks_business_idx" ON "lead_unlocks" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_wallets_user_idx" ON "user_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_leads_user_idx" ON "saved_leads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_leads_business_idx" ON "saved_leads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "saved_searches_user_idx" ON "saved_searches" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");