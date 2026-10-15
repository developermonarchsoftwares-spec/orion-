import { eq } from 'drizzle-orm';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import type { VerificationStatus } from './people.constants';

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

export const STATUS_RANK: Record<VerificationStatus, number> = {
  CONFLICTED: 0,
  UNVERIFIED: 1,
  STALE: 2,
  PARTIALLY_VERIFIED: 3,
  VERIFIED: 4,
};

export const laterDate = (...dates: Array<Date | null | undefined>): Date | null => {
  const valid = dates.filter((d): d is Date => !!d);
  return valid.length ? new Date(Math.max(...valid.map((d) => d.getTime()))) : null;
};

/**
 * Person-level verification/confidence is the strongest of the person's roles (a conflicted role
 * makes the person conflicted). One implementation shared by ingestion and reviewer verification.
 */
export async function rollupPersonVerification(tx: Tx, personId: string): Promise<void> {
  const roles = await tx
    .select({
      v: schema.companyPeople.verificationStatus,
      c: schema.companyPeople.confidenceScore,
      l: schema.companyPeople.lastVerifiedAt,
    })
    .from(schema.companyPeople)
    .where(eq(schema.companyPeople.personId, personId));
  if (!roles.length) return;
  const best = roles.reduce((a, r) => (STATUS_RANK[r.v] > STATUS_RANK[a.v] ? r : a), roles[0]);
  await tx
    .update(schema.people)
    .set({
      verificationStatus: roles.some((r) => r.v === 'CONFLICTED') ? 'CONFLICTED' : best.v,
      confidenceScore: Math.max(...roles.map((r) => r.c)),
      lastVerifiedAt: laterDate(...roles.map((r) => r.l)),
    })
    .where(eq(schema.people.id, personId));
}
