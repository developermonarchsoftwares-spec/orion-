import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { claimedValueFor } from '../policies/claim-verification.policy';

/**
 * Structural check that the operational status columns can never disagree with the verification ledger.
 * Deliberately written independently of the production derivation code: it states the invariants in plain terms.
 *
 *   role      VERIFIED            <=> title AND relationship verified for the CURRENT values
 *             PARTIALLY_VERIFIED  <=> exactly one of them verified, none disputed
 *             CONFLICTED          <=> a role claim disputed for the current value
 *             UNVERIFIED          <=> none verified, none disputed
 *             (VERIFIED / PARTIALLY_VERIFIED also need a last_verified_at)
 *   contact   VERIFIED / CONFLICTED / UNVERIFIED <=> its claim verified / disputed / neither, for the CURRENT value
 *   person    CONFLICTED if any role is; otherwise the strongest role status
 *   SYSTEM rows never carry a human id
 */
const RANK: Record<string, number> = { CONFLICTED: 0, UNVERIFIED: 1, STALE: 2, PARTIALLY_VERIFIED: 3, VERIFIED: 4 };

export async function collectLedgerViolations(db: DrizzleDb): Promise<string[]> {
  const violations: string[] = [];
  const ledger = await db.select().from(schema.peopleVerifications);
  const find = (key: string, value: string) => ledger.find((r) => r.targetKey === key && r.claimedValue === value);

  for (const r of ledger) {
    if (r.verifiedByKind === 'SYSTEM' && r.verifiedById) violations.push(`system row ${r.id} has a human id`);
  }

  const roles = await db.select().from(schema.companyPeople);
  for (const role of roles) {
    const t = find(`TITLE:${role.id}`, claimedValueFor('TITLE', role.normalizedJobTitle));
    const rel = find(`RELATIONSHIP:${role.id}`, claimedValueFor('RELATIONSHIP', role.businessId));
    const disputed = [t, rel].some((x) => x?.status === 'DISPUTED');
    const verified = [t, rel].filter((x) => x?.status === 'VERIFIED').length;
    const expected = disputed ? 'CONFLICTED' : verified === 2 ? 'VERIFIED' : verified === 1 ? 'PARTIALLY_VERIFIED' : 'UNVERIFIED';
    if (role.verificationStatus !== expected) violations.push(`role ${role.id} stored ${role.verificationStatus} but ledger says ${expected}`);
    if ((role.verificationStatus === 'VERIFIED' || role.verificationStatus === 'PARTIALLY_VERIFIED') && !role.lastVerifiedAt) {
      violations.push(`role ${role.id} is ${role.verificationStatus} without last_verified_at`);
    }
  }

  const contacts = await db.select().from(schema.personContacts);
  for (const c of contacts) {
    const claim = c.contactType === 'WORK_EMAIL' ? 'EMAIL' : 'PHONE';
    const row = find(`${claim}:${c.id}`, claimedValueFor(claim, c.normalizedValue));
    const expected = row?.status === 'DISPUTED' ? 'CONFLICTED' : row?.status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
    if (c.verificationStatus !== expected) violations.push(`contact ${c.id} stored ${c.verificationStatus} but ledger says ${expected}`);
  }

  const people = await db.select().from(schema.people);
  for (const p of people) {
    const mine = roles.filter((r) => r.personId === p.id);
    if (!mine.length) continue;
    const expected = mine.some((r) => r.verificationStatus === 'CONFLICTED')
      ? 'CONFLICTED'
      : mine.reduce((best, r) => (RANK[r.verificationStatus] > RANK[best] ? r.verificationStatus : best), 'CONFLICTED' as string);
    // roles are compared after their own check above; a person with only UNVERIFIED roles is UNVERIFIED
    const want = mine.every((r) => r.verificationStatus === 'UNVERIFIED') ? 'UNVERIFIED' : expected;
    if (p.verificationStatus !== want) violations.push(`person ${p.id} stored ${p.verificationStatus} but roles say ${want}`);
  }
  return violations;
}

export async function expectLedgerConsistent(db: DrizzleDb) {
  const v = await collectLedgerViolations(db);
  if (v.length) throw new Error(`Status columns diverged from the verification ledger:\n${v.join('\n')}`);
}
