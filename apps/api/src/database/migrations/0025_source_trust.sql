ALTER TABLE "data_sources" ADD COLUMN "trust_status" varchar(12) DEFAULT 'UNREVIEWED' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "usage_restrictions" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "collection_method" varchar(40);--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "trust_decided_by_id" uuid;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "trust_decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "trust_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_trust_decided_by_id_users_id_fk" FOREIGN KEY ("trust_decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "businesses_source_idx" ON "businesses" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "data_sources_trust_idx" ON "data_sources" USING btree ("trust_status");--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_trust_chk" CHECK ("data_sources"."trust_status" IN ('UNREVIEWED', 'APPROVED', 'RESTRICTED', 'REVOKED'));

--> statement-breakpoint
-- A business whose recorded source has been revoked cannot become PUBLISHED, whichever code path tries it (the import publisher, the web
-- gateway's status screen, a script). Businesses with no recorded source are not affected. Reversible: re-approve the source first.
CREATE FUNCTION businesses_source_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  t text;
BEGIN
  IF NEW.status = 'PUBLISHED' AND NEW.source_id IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'PUBLISHED') THEN
    SELECT trust_status INTO t FROM data_sources WHERE id = NEW.source_id;
    IF t = 'REVOKED' THEN
      RAISE EXCEPTION 'The source of this business has been revoked; it cannot be published' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER businesses_source_guard BEFORE INSERT OR UPDATE OF status ON businesses
FOR EACH ROW EXECUTE FUNCTION businesses_source_guard();
