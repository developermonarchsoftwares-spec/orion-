import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { CsvSecurityUtil } from '../../common/utils/csv-security.util';
import { PeopleService } from './people.service';

/** Most people one export contains (the newest unlocks first); keeps one request from loading an unbounded history. */
export const MAX_EXPORT_PEOPLE = 5000;

/** Phone and Mobile: kept intact in CSV when they are plain numbers. */
export const PEOPLE_EXPORT_PHONE_COLUMNS = [8, 9];

export const PEOPLE_EXPORT_HEADERS = [
  'Company',
  'Person',
  'Job Title',
  'Department',
  'Seniority',
  'Decision Maker Type',
  'Role Status',
  'Email',
  'Phone',
  'Mobile',
  'LinkedIn',
  'Location',
  'Verification Status',
  'Confidence',
  'Last Verified',
];

/**
 * Exports people the caller has unlocked. Authorisation is enforced here, not in the client:
 * the set of exportable people is derived from person_unlocks, so requested ids that are not
 * unlocked are dropped, and PeopleService only populates contact values for unlocked people.
 */
@Injectable()
export class PeopleExportService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly peopleService: PeopleService,
  ) {}

  /** The exportable table (headers + rows), shared by the CSV download and the XLSX / scheduled exports. */
  async exportUnlockedPeopleTable(userId: string, requestedPersonIds?: string[]) {
    const requested = [...new Set(requestedPersonIds ?? [])];
    const unlocks = await this.db
      .select({ personId: schema.personUnlocks.personId })
      .from(schema.personUnlocks)
      .where(
        requested.length
          ? and(eq(schema.personUnlocks.userId, userId), inArray(schema.personUnlocks.personId, requested))
          : eq(schema.personUnlocks.userId, userId),
      )
      .orderBy(desc(schema.personUnlocks.unlockedAt), desc(schema.personUnlocks.id))
            .limit(MAX_EXPORT_PEOPLE);
    const personIds = unlocks.map((u) => u.personId);
    // a full page may mean there is more: only then is it worth counting
    let truncated = false;
    if (unlocks.length === MAX_EXPORT_PEOPLE && !requested.length) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.personUnlocks).where(eq(schema.personUnlocks.userId, userId));
      truncated = Number(n) > MAX_EXPORT_PEOPLE;
    }

    const rows: unknown[][] = [];

    for (const personId of personIds) {
      const roles = await this.peopleService.loadPublishedRolesForPerson(personId);
      const cards = await this.peopleService.buildCards(roles, userId);
      const businessIds = [...new Set(cards.map((c) => c.businessId))];
      const names = businessIds.length
        ? await this.db
            .select({ id: schema.businesses.id, name: schema.businesses.name })
            .from(schema.businesses)
            .where(inArray(schema.businesses.id, businessIds))
        : [];
      const nameById = new Map(names.map((n) => [n.id, n.name]));

      for (const c of cards) {
        rows.push([
          nameById.get(c.businessId) ?? '',
          c.fullName,
          c.jobTitle,
          c.department.label,
          c.seniority.label,
          c.decisionMaker?.label ?? '',
          c.isCurrent ? 'Current' : 'Former',
          c.contacts.email.value ?? '',
          c.contacts.phone.value ?? '',
          c.contacts.mobile.value ?? '',
          c.contacts.linkedin.value ?? '',
          [c.location.city, c.location.state].filter(Boolean).join(', '),
          c.verification.status,
          `${c.verification.confidence.level} (${c.verification.confidence.score})`,
          c.verification.lastVerifiedAt ? new Date(c.verification.lastVerifiedAt).toISOString().slice(0, 10) : '',
        ]);
      }
    }

    return { headers: PEOPLE_EXPORT_HEADERS, rows, truncated, phoneColumns: PEOPLE_EXPORT_PHONE_COLUMNS, skippedLocked: Math.max(0, requested.length - personIds.length) };
  }

  async exportUnlockedPeopleCsv(userId: string, requestedPersonIds?: string[]) {
    const t = await this.exportUnlockedPeopleTable(userId, requestedPersonIds);
    const lines = [CsvSecurityUtil.formatCsvRow(t.headers), ...t.rows.map((r) => CsvSecurityUtil.formatCsvRow(r, t.phoneColumns))];
    return {
      // BOM so Excel opens UTF-8 names correctly (same as the existing lead export).
      csv: `\ufeff${lines.join('\n')}\n`,
      rowCount: t.rows.length,
      filename: `orion-unlocked-people-${new Date().toISOString().slice(0, 10)}.csv`,
      skippedLocked: t.skippedLocked,
    };
  }
}
