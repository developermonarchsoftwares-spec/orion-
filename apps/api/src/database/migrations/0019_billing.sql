-- Billing: persisted payment orders, invoices (sequential numbers), refunds, and the per-user subscription / tier.
-- Idempotent on purpose, like 0017 / 0018: the applied history of existing databases is unknown.
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" START WITH 1 INCREMENT BY 1;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"package_id" uuid,
	"credits" integer NOT NULL,
	"amount_paise" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"billing_cycle" varchar(10) DEFAULT 'monthly' NOT NULL,
	"status" varchar(16) DEFAULT 'CREATED' NOT NULL,
	"payment_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(32) NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" varchar(64),
	"payment_id" varchar(64) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"description" varchar(255) NOT NULL,
	"credits" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"subtotal_paise" integer NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"tax_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"status" varchar(16) DEFAULT 'ISSUED' NOT NULL,
	"billing_name" varchar(255),
	"billing_email" varchar(255),
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refunded_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" varchar(64) NOT NULL,
	"invoice_id" uuid,
	"user_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"credits_reversed" integer DEFAULT 0 NOT NULL,
	"credits_shortfall" integer DEFAULT 0 NOT NULL,
	"reason" varchar(255) NOT NULL,
	"status" varchar(24) NOT NULL,
	"gateway_refund_id" varchar(64),
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"package_id" uuid,
	"tier" varchar(50) NOT NULL,
	"billing_cycle" varchar(10) DEFAULT 'monthly' NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"payment_id" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_order_id_idx" ON "payment_orders" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_user_idx" ON "payment_orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_number_idx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_payment_idx" ON "invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_user_idx" ON "invoices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refunds_user_idx" ON "refunds" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_user_idx" ON "user_subscriptions" USING btree ("user_id");
