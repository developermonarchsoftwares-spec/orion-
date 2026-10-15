import { Inject, Injectable } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import { TRIAGE_CATEGORIES, TRIAGE_PRIORITIES, TriageQueryDto } from './review.dto';

const csv = (v?: string) => (v ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

export interface ITriageItem {
  /** Stable: '<source>:<underlying id>'. The same underlying issue always has the same id (no duplicates, no second lifecycle). */
  id: string;
  category: (typeof TRIAGE_CATEGORIES)[number];
  /** The existing machine code of the underlying record (quarantine reason code, conflict type, ...). Never an internal rule id. */
  reasonCode: string;
  priority: (typeof TRIAGE_PRIORITIES)[number];
  /** Status of the UNDERLYING record, read live. */
  status: string;
  refType: 'QUARANTINE' | 'CONFLICT' | 'ROLE' | 'CONTACT';
  refId: string;
  personId: string | null;
  personName: string | null;
  businessId: string | null;
  companyName: string | null;
  detectedAt: Date;
  updatedAt: Date;
  /** Where the reviewer resolves it: an EXISTING internal workflow. Triage resolves nothing itself. */
  link: { workflow: 'QUARANTINE_REVIEW' | 'ROLE_REVIEW' | 'VERIFICATION_REVIEW'; path: string };
}

/**
 * The derived item set. Each branch reads one existing signal and only its ACTIVE state. Priority rank (0 CRITICAL .. 3 LOW):
 *   SUPPRESSION quarantine                                                          CRITICAL
 *   anything open on a person with a PUBLISHED role (customer-visible data at risk) CRITICAL
 *   IDENTITY quarantine (ambiguous person / company)                                HIGH
 *   other open conflicts, verification disputes                                     HIGH
 *   other quarantine (data to fix)                                                  NORMAL
 *   unclassified title on a pending role                                            LOW
 */
const ITEMS_CTE = sql`
WITH quarantine AS (
  SELECT q.id, q.status, q.created_at, q.updated_at, q.raw, q.reasons,
    COALESCE(q.reasons->0->>'code', 'UNKNOWN') AS code,
    (q.reasons @> '[{"code":"SUPPRESSED_PERSON"}]'::jsonb OR q.reasons @> '[{"code":"PERSON_SUPPRESSED"}]'::jsonb) AS suppressed,
    (q.reasons @> '[{"code":"AMBIGUOUS_IDENTITY"}]'::jsonb OR q.reasons @> '[{"code":"AMBIGUOUS_COMPANY_MATCH"}]'::jsonb OR q.reasons @> '[{"code":"BUSINESS_NOT_FOUND"}]'::jsonb) AS identity
  FROM people_ingestion_quarantine q WHERE q.status = 'PENDING'
),
conflict AS (
  SELECT c.id, c.status, c.conflict_type, c.first_detected_at, c.last_detected_at, c.business_id,
    COALESCE(c.person_id, (SELECT l.person_id FROM people_conflict_links l WHERE l.conflict_id = c.id AND l.person_id IS NOT NULL ORDER BY l.created_at, l.id LIMIT 1)) AS pid
  FROM people_conflicts c WHERE c.status = 'OPEN'
),
items AS (
  SELECT 'quarantine:' || q.id::text AS id,
    CASE WHEN q.suppressed THEN 'SUPPRESSION' WHEN q.identity THEN 'IDENTITY' ELSE 'QUARANTINE' END AS category,
    q.code AS reason_code,
    CASE WHEN q.suppressed THEN 0 WHEN q.identity THEN 1 ELSE 2 END AS priority_rank,
    q.status AS status, 'QUARANTINE' AS ref_type, q.id::text AS ref_id,
    NULL::uuid AS person_id, q.raw->>'personName' AS person_name, NULL::uuid AS business_id, NULL::text AS company_name,
    q.created_at AS detected_at, q.updated_at AS updated_at, 'QUARANTINE' AS link_kind, NULL::uuid AS role_id
  FROM quarantine q

  UNION ALL
  SELECT 'conflict:' || c.id::text,
    CASE WHEN c.conflict_type IN ('CONTACT_MULTIPLE_PEOPLE', 'CONTACT_CONFLICTING_VALUES') THEN 'CONTACT'
         WHEN c.conflict_type = 'IDENTITY_LINKEDIN' THEN 'IDENTITY' ELSE 'CONFLICT' END,
    c.conflict_type,
    CASE WHEN EXISTS (SELECT 1 FROM company_people pr WHERE pr.person_id = c.pid AND pr.is_published) THEN 0 ELSE 1 END,
    c.status, 'CONFLICT', c.id::text,
    c.pid, p.full_name, c.business_id, b.name,
    c.first_detected_at, c.last_detected_at, 'ROLE',
    (SELECT cp.id FROM company_people cp WHERE cp.person_id = c.pid ORDER BY (cp.business_id = c.business_id) DESC NULLS LAST, cp.created_at, cp.id LIMIT 1)
  FROM conflict c
  LEFT JOIN people p ON p.id = c.pid
  LEFT JOIN businesses b ON b.id = c.business_id
  WHERE EXISTS (SELECT 1 FROM company_people cp0 WHERE cp0.person_id = c.pid)

  UNION ALL
  SELECT 'role-verification:' || r.id::text, 'VERIFICATION', 'VERIFICATION_CONFLICTED',
    CASE WHEN r.is_published THEN 0 ELSE 1 END,
    r.review_status, 'ROLE', r.id::text,
    r.person_id, p.full_name, r.business_id, b.name,
    r.updated_at, r.updated_at, 'VERIFICATION', r.id
  FROM company_people r
  JOIN people p ON p.id = r.person_id
  JOIN businesses b ON b.id = r.business_id
  WHERE r.verification_status::text = 'CONFLICTED' AND r.review_status <> 'REJECTED' AND p.data_status <> 'SUPPRESSED'

  UNION ALL
  SELECT 'contact-verification:' || pc.id::text, 'VERIFICATION', 'VERIFICATION_CONFLICTED',
    CASE WHEN EXISTS (SELECT 1 FROM company_people pr WHERE pr.person_id = pc.person_id AND pr.is_published) THEN 0 ELSE 1 END,
    CASE WHEN pc.is_published THEN 'PUBLISHED' ELSE 'UNPUBLISHED' END, 'CONTACT', pc.id::text,
    pc.person_id, p.full_name, NULL::uuid, NULL::text,
    pc.updated_at, pc.updated_at, 'VERIFICATION',
    (SELECT cp.id FROM company_people cp WHERE cp.person_id = pc.person_id ORDER BY cp.created_at, cp.id LIMIT 1)
  FROM person_contacts pc
  JOIN people p ON p.id = pc.person_id
  WHERE pc.verification_status::text = 'CONFLICTED' AND p.data_status <> 'SUPPRESSED'
    AND EXISTS (SELECT 1 FROM company_people cp1 WHERE cp1.person_id = pc.person_id)

  UNION ALL
  SELECT 'role-classification:' || r.id::text, 'CLASSIFICATION', 'UNCLASSIFIED_TITLE', 3,
    r.review_status, 'ROLE', r.id::text,
    r.person_id, p.full_name, r.business_id, b.name,
    r.created_at, r.updated_at, 'ROLE', r.id
  FROM company_people r
  JOIN people p ON p.id = r.person_id
  JOIN businesses b ON b.id = r.business_id
  WHERE r.review_status = 'PENDING' AND r.seniority_level = 'UNKNOWN' AND r.classification_source = 'AUTO' AND p.data_status <> 'SUPPRESSED'
)
`;

/**
 * Review triage (Phase 6.10): ONE read-only list over signals that already exist (quarantine, open conflicts, verification
 * disputes, unclassified titles). It stores nothing and has no lifecycle of its own: every item is derived, per request, from
 * the underlying record, so it appears and disappears exactly when that record's own state changes. Priority is a fixed,
 * documented rule set (docs/PEOPLE_REVIEW_TRIAGE.md), not a score. Order: priority, then oldest detection first, then id.
 *
 * It exposes no raw payload, digest, rule id, source key or reviewer identity.
 */
@Injectable()
export class PeopleTriageService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb) {}

  async list(q: TriageQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 25;
    const conds: SQL[] = [];
    const cats = csv(q.category).filter((c) => (TRIAGE_CATEGORIES as readonly string[]).includes(c));
    if (q.category && cats.length === 0) conds.push(sql`false`);
    if (cats.length) conds.push(sql`i.category IN (${sql.join(cats.map((c) => sql`${c}`), sql`, `)})`);
    const pris = csv(q.priority).filter((p) => p in PRIORITY_RANK);
    if (q.priority && pris.length === 0) conds.push(sql`false`);
    if (pris.length) conds.push(sql`i.priority_rank IN (${sql.join(pris.map((p) => sql`${PRIORITY_RANK[p]}`), sql`, `)})`);
    if (q.status?.trim()) conds.push(sql`i.status = ${q.status.trim().toUpperCase()}`);
    if (q.businessId) conds.push(sql`i.business_id = ${q.businessId}`);
    if (q.personId) conds.push(sql`i.person_id = ${q.personId}`);
    if (q.q?.trim()) {
      const like = `%${q.q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      conds.push(sql`(i.person_name ILIKE ${like} OR i.company_name ILIKE ${like})`);
    }
    if (q.detectedFrom) conds.push(sql`i.detected_at >= ${new Date(q.detectedFrom).toISOString()}::timestamptz`);
    if (q.detectedTo) conds.push(sql`i.detected_at <= ${new Date(q.detectedTo).toISOString()}::timestamptz`);
    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const [rowsRes, countRes]: any[] = await Promise.all([
      this.db.execute(sql`${ITEMS_CTE} SELECT i.* FROM items i ${where} ORDER BY i.priority_rank ASC, i.detected_at ASC, i.id ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.db.execute(sql`${ITEMS_CTE} SELECT count(*)::int AS n FROM items i ${where}`),
    ]);
    const rows = (rowsRes.rows ?? rowsRes) as any[];
    const total = Number((countRes.rows ?? countRes)[0]?.n ?? 0);

    const items: ITriageItem[] = rows.map((r) => ({
      id: r.id,
      category: r.category,
      reasonCode: r.reason_code,
      priority: (['CRITICAL', 'HIGH', 'NORMAL', 'LOW'] as const)[r.priority_rank],
      status: r.status,
      refType: r.ref_type,
      refId: r.ref_id,
      personId: r.person_id,
      personName: r.person_name,
      businessId: r.business_id,
      companyName: r.company_name,
      detectedAt: new Date(r.detected_at),
      updatedAt: new Date(r.updated_at),
      link:
        r.link_kind === 'QUARANTINE'
          ? { workflow: 'QUARANTINE_REVIEW', path: `/internal/people-review/quarantine/${r.ref_id}` }
          : { workflow: r.link_kind === 'VERIFICATION' ? 'VERIFICATION_REVIEW' : 'ROLE_REVIEW', path: `/internal/people-review/roles/${r.role_id}` },
    }));
    return { items, pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 } };
  }
}
