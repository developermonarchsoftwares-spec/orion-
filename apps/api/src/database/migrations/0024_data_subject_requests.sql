CREATE TABLE "contact_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity_kind" varchar(8) NOT NULL,
	"identity_digest" varchar(64) NOT NULL,
	"scope" varchar(8) NOT NULL,
	"request_id" uuid,
	"reason_code" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(20) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"type" varchar(12) NOT NULL,
	"status" varchar(12) DEFAULT 'REQUESTED' NOT NULL,
	"subject_kind" varchar(8) NOT NULL,
	"subject_digest" varchar(64) NOT NULL,
	"requester_role" varchar(14) DEFAULT 'SUBJECT' NOT NULL,
	"evidence" varchar(20) DEFAULT 'NONE' NOT NULL,
	"contact_email" varchar(255),
	"proposed_value" varchar(255),
	"details" varchar(500),
	"requester_note" varchar(500),
	"public_message" varchar(300),
	"decision_reason" varchar(500),
	"match_summary" jsonb,
	"result_summary" jsonb,
	"verified_at" timestamp with time zone,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_suppressions" ADD CONSTRAINT "contact_suppressions_request_id_data_subject_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."data_subject_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_suppressions_uq" ON "contact_suppressions" USING btree ("identity_kind","identity_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "dsr_reference_uq" ON "data_subject_requests" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "dsr_open_subject_uq" ON "data_subject_requests" USING btree ("type","subject_kind","subject_digest") WHERE "data_subject_requests"."status" NOT IN ('COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE INDEX "dsr_status_idx" ON "data_subject_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "dsr_subject_idx" ON "data_subject_requests" USING btree ("subject_kind","subject_digest");

--> statement-breakpoint
-- One normalisation, shared by the database guard below and by the application (ContactSuppressionService.digest), so a value
-- hashes identically wherever it is written. EMAIL: trimmed, lower case. PHONE: digits only, the last ten (drops +91 / 0). LINKEDIN: host
-- and path without scheme, www, query, fragment or trailing slash. Returns NULL when the value cannot be normalised.
CREATE FUNCTION orion_contact_digest(kind text, value text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v text;
  d text;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF kind = 'EMAIL' THEN
    v := lower(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
    IF position('@' IN v) = 0 THEN RETURN NULL; END IF;
  ELSIF kind = 'PHONE' THEN
    d := regexp_replace(value, '[^0-9]', '', 'g');
    IF length(d) < 7 THEN RETURN NULL; END IF;
    v := right(d, 10);
  ELSIF kind = 'LINKEDIN' THEN
    v := lower(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
    v := regexp_replace(v, '^https?://', '');
    v := regexp_replace(v, '^[a-z0-9-]+\.linkedin\.com', 'linkedin.com');
    v := regexp_replace(v, '[?#].*$', '');
    v := regexp_replace(v, '/+$', '');
    IF v NOT LIKE 'linkedin.com/%' THEN RETURN NULL; END IF;
  ELSE
    RETURN NULL;
  END IF;
  RETURN encode(sha256(convert_to(v, 'UTF8')), 'hex');
END
$$;
--> statement-breakpoint
-- Guard on the customer-facing company contacts: whatever writes a row (import publishing, a script, direct SQL), a suppressed value
-- does not get in. CONTACT scope on insert: the row is not stored. FIELD scope, or an update: the value is cleared and its verification reset.
CREATE FUNCTION business_contacts_suppression_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s text;
BEGIN
  IF NEW.email IS NOT NULL THEN
    SELECT scope INTO s FROM contact_suppressions WHERE identity_kind = 'EMAIL' AND identity_digest = orion_contact_digest('EMAIL', NEW.email);
    IF s = 'CONTACT' AND TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    IF s IS NOT NULL THEN NEW.email := NULL; NEW.is_email_verified := false; END IF;
  END IF;
  s := NULL;
  IF NEW.linkedin_url IS NOT NULL THEN
    SELECT scope INTO s FROM contact_suppressions WHERE identity_kind = 'LINKEDIN' AND identity_digest = orion_contact_digest('LINKEDIN', NEW.linkedin_url);
    IF s = 'CONTACT' AND TG_OP = 'INSERT' THEN RETURN NULL; END IF;
    IF s IS NOT NULL THEN NEW.linkedin_url := NULL; END IF;
  END IF;
  s := NULL;
  IF NEW.phone IS NOT NULL THEN
    SELECT scope INTO s FROM contact_suppressions WHERE identity_kind = 'PHONE' AND identity_digest = orion_contact_digest('PHONE', NEW.phone);
    IF s IS NOT NULL THEN NEW.phone := NULL; NEW.is_phone_verified := false; NEW.is_direct_dial := false; END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER business_contacts_suppression_guard BEFORE INSERT OR UPDATE ON business_contacts
FOR EACH ROW EXECUTE FUNCTION business_contacts_suppression_guard();
--> statement-breakpoint
-- A suppression is never edited or deleted; the only allowed change is widening FIELD to CONTACT (and the foreign key clearing request_id).
CREATE FUNCTION contact_suppressions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'contact_suppressions rows cannot be deleted';
  END IF;
  IF NEW.identity_kind IS DISTINCT FROM OLD.identity_kind
     OR NEW.identity_digest IS DISTINCT FROM OLD.identity_digest
     OR NEW.reason_code IS DISTINCT FROM OLD.reason_code
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (NEW.scope IS DISTINCT FROM OLD.scope AND NOT (OLD.scope = 'FIELD' AND NEW.scope = 'CONTACT')) THEN
    RAISE EXCEPTION 'contact_suppressions rows cannot be edited';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER contact_suppressions_immutable BEFORE UPDATE OR DELETE ON contact_suppressions
FOR EACH ROW EXECUTE FUNCTION contact_suppressions_immutable();
