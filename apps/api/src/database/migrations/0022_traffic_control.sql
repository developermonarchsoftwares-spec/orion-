-- API protection: admin-managed IP rules, temporary blocks (manual and automatic), and per-user rate-limit overrides.
-- Idempotent on purpose, like 0017..0021: the applied history of existing databases is unknown.
CREATE TABLE IF NOT EXISTS "ip_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cidr" varchar(64) NOT NULL,
	"action" varchar(8) NOT NULL,
	"scope" varchar(8) DEFAULT 'GLOBAL' NOT NULL,
	"reason" varchar(200) NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "traffic_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" varchar(8) NOT NULL,
	"subject" varchar(64) NOT NULL,
	"reason" varchar(200) NOT NULL,
	"source" varchar(8) NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_rate_overrides" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"per_minute" integer,
	"per_day" integer,
	"note" varchar(200),
	"set_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_rate_overrides" ADD CONSTRAINT "user_rate_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ip_rules_scope_idx" ON "ip_rules" USING btree ("scope","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_blocks_active_idx" ON "traffic_blocks" USING btree ("subject_type","subject","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_blocks_created_idx" ON "traffic_blocks" USING btree ("created_at");
