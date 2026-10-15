/**
 * Reviewer-facing wording for where a contact came from, as the review API reports it (`contacts[].attribution`). Pure and
 * display-only: it never decides anything about customers; the customer rule lives in the API's attribution helper and this only
 * labels its answer for the dossier. It invents nothing: a missing or unknown status shows no badge.
 */

export type ContactAttributionStatus = 'THIS_COMPANY' | 'SHARED' | 'OTHER_COMPANY' | 'UNATTRIBUTED';

export interface IContactAttributionInfo {
  status: ContactAttributionStatus;
  /** Whether this company's customer cards may show the contact (once published and the role is visible). */
  eligibleForThisCompany: boolean;
}

export type AttributionTone = 'ok' | 'warn' | 'muted';

export interface IAttributionBadge {
  label: string;
  hint: string;
  tone: AttributionTone;
}

const STATUSES: readonly string[] = ['THIS_COMPANY', 'SHARED', 'OTHER_COMPANY', 'UNATTRIBUTED'];

export function attributionBadge(a: IContactAttributionInfo | null | undefined): IAttributionBadge | null {
  if (!a || !STATUSES.includes(a.status)) return null;
  switch (a.status) {
    case 'THIS_COMPANY':
      return { label: 'Reported by this company', hint: "Eligible for this company's customer cards once published.", tone: 'ok' };
    case 'SHARED':
      return { label: 'Shared with this company', hint: 'Reported by this company and at least one other; eligible on each of them once published.', tone: 'ok' };
    case 'OTHER_COMPANY':
      return { label: 'Reported by another company', hint: "Never shown on this company's customer cards, even when published.", tone: 'warn' };
    case 'UNATTRIBUTED':
      return a.eligibleForThisCompany
        ? { label: 'Unattributed (shown)', hint: 'No import attributes it to a company. This person has one company, so it is shown there once published.', tone: 'muted' }
        : { label: 'Unattributed (not shown)', hint: 'No import attributes it to a company and this person has several, so no company card shows it, even when published.', tone: 'warn' };
  }
}
