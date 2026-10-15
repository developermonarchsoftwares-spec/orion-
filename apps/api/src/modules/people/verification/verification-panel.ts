import * as schema from '../../../database/schema';
import {
  ACCEPTED_EVIDENCE,
  CLAIM_LABELS,
  ClaimState,
  ClaimType,
  ILedgerRow,
  claimState,
  claimedValueFor,
  evidenceStrength,
  targetKeyOf,
} from '../policies/claim-verification.policy';

type RoleRow = typeof schema.companyPeople.$inferSelect;
type PersonRow = typeof schema.people.$inferSelect;
type ContactRow = typeof schema.personContacts.$inferSelect;
type EvidenceRow = typeof schema.peopleEvidence.$inferSelect;
export type LedgerDbRow = typeof schema.peopleVerifications.$inferSelect;

export const toLedgerRow = (r: LedgerDbRow): ILedgerRow => ({
  id: r.id,
  claimType: r.claimType,
  targetKey: r.targetKey,
  claimedValue: r.claimedValue,
  status: r.status,
  evidenceId: r.evidenceId,
  evidenceStrength: r.evidenceStrength,
  verifiedByLabel: r.verifiedByLabel,
  verifiedByKind: r.verifiedByKind,
  method: r.method,
  attestedBy: r.attestedBy,
  verifiedAt: r.verifiedAt,
  note: r.note,
});

/** The current normalised value a claim is about. null = nothing to verify (e.g. no LinkedIn on file). */
export function currentClaimValue(claim: ClaimType, s: { role: RoleRow; person: PersonRow; contact?: ContactRow }): string | null {
  switch (claim) {
    case 'IDENTITY':
      return s.person.normalizedName;
    case 'LINKEDIN':
      return s.person.normalizedLinkedinUrl ?? null;
    case 'RELATIONSHIP':
      return s.role.businessId;
    case 'TITLE':
      return s.role.normalizedJobTitle;
    default:
      return s.contact?.normalizedValue ?? null;
  }
}

export interface IClaimView {
  claim: ClaimType;
  label: string;
  contactId: string | null;
  currentValue: string | null;
  displayValue: string | null;
  state: ClaimState;
  previousValue: string | null;
  verifiedBy: string | null;
  /** REVIEWER (a named person) or SYSTEM (ingestion / migration; nobody in this system verified it). */
  verifiedByKind: 'REVIEWER' | 'SYSTEM' | null;
  method: string | null;
  attestedBy: string | null;
  verifiedAt: Date | null;
  note: string | null;
  basis: { evidenceId: string; evidenceType: string; sourceType: string; reference: string | null; strength: number } | null;
  acceptedEvidenceTypes: readonly string[];
  eligibleEvidence: Array<{ id: string; evidenceType: string; sourceType: string; reference: string | null; observedAt: Date }>;
}

const cited = (e: EvidenceRow) => !!((e.sourceReference ?? '').trim() || (e.sourceUrl ?? '').trim());

/**
 * Field-by-field verification view for one role. Pure: callers pass rows they already loaded,
 * so the review detail adds one query (the ledger) and no per-claim queries.
 */
export function buildVerificationPanel(input: {
  role: RoleRow;
  person: PersonRow;
  contacts: ContactRow[];
  evidence: EvidenceRow[];
  ledger: ILedgerRow[];
  /** Shown for the company-relationship claim (its stored value is the company id). */
  companyName?: string | null;
  now?: Date;
}): IClaimView[] {
  const { role, person, contacts, evidence, ledger } = input;
  const byKey = new Map<string, ILedgerRow[]>();
  for (const r of ledger) byKey.set(r.targetKey, [...(byKey.get(r.targetKey) ?? []), r]);
  const evById = new Map(evidence.map((e) => [e.id, e]));

  const view = (claim: ClaimType, contact?: ContactRow): IClaimView => {
    const value = currentClaimValue(claim, { role, person, contact });
    const key = targetKeyOf(claim, { personId: person.id, roleId: role.id, contactId: contact?.id });
    const { state, row, previousValue: rawPrevious } = claimState(byKey.get(key) ?? [], value === null ? null : claimedValueFor(claim, value), input.now);
    // contact data is stored as a digest only: never surface it, just say the value changed
    const previousValue = rawPrevious && !rawPrevious.startsWith('h:') ? rawPrevious : null;
    const basisEv = row?.evidenceId ? evById.get(row.evidenceId) : undefined;
    const scoped = evidence.filter((e) =>
      claim === 'IDENTITY' || claim === 'LINKEDIN'
        ? !e.companyPersonId && !e.contactId
        : claim === 'RELATIONSHIP' || claim === 'TITLE'
          ? e.companyPersonId === role.id && !e.contactId
          : e.contactId === contact?.id,
    );
    return {
      claim,
      label: contact ? `${CLAIM_LABELS[claim]} (${contact.contactType === 'MOBILE' ? 'mobile' : claim === 'EMAIL' ? 'work' : 'landline'})` : CLAIM_LABELS[claim],
      contactId: contact?.id ?? null,
      currentValue: value,
      displayValue: claim === 'IDENTITY' ? person.fullName : claim === 'TITLE' ? role.jobTitleAtCompany : claim === 'LINKEDIN' ? person.linkedinUrl : claim === 'RELATIONSHIP' ? (input.companyName ?? role.businessId) : (contact?.contactValue ?? null),
      state,
      previousValue,
      verifiedBy: row?.verifiedByLabel ?? null,
      verifiedByKind: (row?.verifiedByKind as 'REVIEWER' | 'SYSTEM' | undefined) ?? null,
      method: row?.method ?? null,
      attestedBy: row?.attestedBy ?? null,
      verifiedAt: row?.verifiedAt ?? null,
      note: row?.note ?? null,
      basis: row
        ? {
            evidenceId: row.evidenceId ?? '',
            evidenceType: basisEv?.evidenceType ?? '',
            sourceType: basisEv?.sourceType ?? '',
            reference: basisEv?.sourceUrl || basisEv?.sourceReference || null,
            strength: row.evidenceStrength,
          }
        : null,
      acceptedEvidenceTypes: ACCEPTED_EVIDENCE[claim],
      eligibleEvidence: scoped
        .filter((e) => ACCEPTED_EVIDENCE[claim].includes(e.evidenceType) && cited(e))
        .map((e) => ({ id: e.id, evidenceType: e.evidenceType, sourceType: e.sourceType, reference: e.sourceUrl || e.sourceReference || null, observedAt: e.observedAt })),
    };
  };

  const out: IClaimView[] = [view('IDENTITY'), view('RELATIONSHIP'), view('TITLE')];
  if (person.linkedinUrl) out.push(view('LINKEDIN'));
  for (const c of contacts) {
    if (c.contactType === 'WORK_EMAIL') out.push(view('EMAIL', c));
    else out.push(view('PHONE', c));
  }
  return out;
}

export { evidenceStrength };
