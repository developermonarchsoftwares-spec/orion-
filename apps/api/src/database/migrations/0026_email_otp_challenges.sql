CREATE TABLE "email_otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"otp_hash" varchar(128) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"proof_hash" varchar(128),
	"proof_expires_at" timestamp with time zone,
	"proof_consumed_at" timestamp with time zone,
	"ip_hash" varchar(64)
);
--> statement-breakpoint
CREATE INDEX "idx_email_otp_email_purpose_created" ON "email_otp_challenges" USING btree ("email","purpose","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_otp_ip_created" ON "email_otp_challenges" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_otp_expires_at" ON "email_otp_challenges" USING btree ("expires_at");