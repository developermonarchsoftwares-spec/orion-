CREATE TYPE "public"."package_billing_type" AS ENUM('ONE_TIME', 'SUBSCRIPTION', 'DAILY_FREE', 'CUSTOM');--> statement-breakpoint
ALTER TYPE "public"."credit_transaction_type" ADD VALUE 'DAILY_ALLOCATION';--> statement-breakpoint
ALTER TYPE "public"."credit_transaction_type" ADD VALUE 'DAILY_EXPIRATION';--> statement-breakpoint
ALTER TYPE "public"."credit_transaction_type" ADD VALUE 'PACKAGE_PURCHASE';--> statement-breakpoint
ALTER TYPE "public"."credit_transaction_type" ADD VALUE 'SUBSCRIPTION';--> statement-breakpoint
CREATE TABLE "credit_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"price_inr" integer,
	"credits" integer NOT NULL,
	"user_limit" integer,
	"billing_type" varchar(50) DEFAULT 'ONE_TIME' NOT NULL,
	"popular" boolean DEFAULT false NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"badge_text" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"description" varchar(255),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_wallets" ALTER COLUMN "balance" SET DEFAULT 5;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "balance_type" varchar(50) DEFAULT 'PURCHASED';--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "daily_balance_after" integer;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "purchased_balance_after" integer;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD COLUMN "daily_credits" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD COLUMN "purchased_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_wallets" ADD COLUMN "last_daily_credit_date" varchar(10);--> statement-breakpoint
CREATE UNIQUE INDEX "credit_packages_slug_idx" ON "credit_packages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "credit_packages_is_active_idx" ON "credit_packages" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "credit_packages_sort_order_idx" ON "credit_packages" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "pricing_settings_key_idx" ON "pricing_settings" USING btree ("key");