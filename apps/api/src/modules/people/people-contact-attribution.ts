import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';

/**
 * COMPANY CONTEXT FOR CONTACTS (Phase 10B).
 *
 * person_contacts are person-level, so which company a contact belongs to is not stored on the contact. It IS recorded by ingestion:
 * every imported contact has an observation claim (people_observation_claims.contact_id) whose observation
 * (people_observations.company_person_id) names the role that reported it. This file is the ONE place that turns those records into
 * the question the customer surfaces ask: "may this contact be shown on a role at THIS company?". No schema, import or verification
 * change. It returns only a yes / no; no observation data ever leaves this file.
 *
 * The unit of attribution is the COMPANY: a person may hold several roles at one company (the card shows the strongest and lists the
 * rest), and a contact reported for any of them belongs to that company relationship.
 *
 * Rule (see PEOPLE_CUSTOMER_CONTRACT.md):
 *   1. A contact attributed to a company is eligible for that company's role cards, and only for the companies it is attributed to
 *      (several companies can all have reported it: then each may show it).
 *   2. A contact attributed to other companies only is NEVER eligible for this company, and there is no fallback to it.
 *   3. A contact with no attribution (reviewer-added, or from a source that records no observation) is not guessed into a company.
 *      The one exception is when it cannot belong to anyone else: the person has exactly one company (counting every role in any
 *      review state), so there is no other company it could be attributed to. With two or more companies it stays hidden.
 */

type Q = Pick<DrizzleDb, 'select'>;

export interface IContactAttribution {
  /** contact id -> the companies (business ids) whose observations claimed it. Absent = unattributed. */
  businessesByContact: Map<string, Set<string>>;
  /** person id -> number of distinct companies the person has a role at, in ANY review state. */
  companyCount: Map<string, number>;
}

export const loadContactAttribution = async (q: Q, personIds: string[]): Promise<IContactAttribution> => {
  const businessesByContact = new Map<string, Set<string>>();
  const companyCount = new Map<string, number>();
  if (personIds.length === 0) return { businessesByContact, companyCount };

  const claims = await q
    .select({ contactId: schema.peopleObservationClaims.contactId, businessId: schema.companyPeople.businessId })
    .from(schema.peopleObservationClaims)
    .innerJoin(schema.peopleObservations, eq(schema.peopleObservations.id, schema.peopleObservationClaims.observationId))
    .innerJoin(schema.companyPeople, eq(schema.companyPeople.id, schema.peopleObservations.companyPersonId))
    .innerJoin(schema.personContacts, eq(schema.personContacts.id, schema.peopleObservationClaims.contactId))
    .where(inArray(schema.personContacts.personId, personIds));
  for (const c of claims) {
    if (!c.contactId) continue;
    if (!businessesByContact.has(c.contactId)) businessesByContact.set(c.contactId, new Set());
    businessesByContact.get(c.contactId)!.add(c.businessId);
  }

  const roles = await q
    .select({ personId: schema.companyPeople.personId, businessId: schema.companyPeople.businessId })
    .from(schema.companyPeople)
    .where(inArray(schema.companyPeople.personId, personIds));
  const seen = new Map<string, Set<string>>();
  for (const r of roles) {
    if (!seen.has(r.personId)) seen.set(r.personId, new Set());
    seen.get(r.personId)!.add(r.businessId);
  }
  for (const [personId, set] of seen) companyCount.set(personId, set.size);

  return { businessesByContact, companyCount };
};

/** May this contact be shown on a role at this company? (the single decision; everything else calls it) */
export const isContactEligibleForCompany = (contact: { id: string; personId: string }, businessId: string, attribution: IContactAttribution): boolean => {
  const attributedTo = attribution.businessesByContact.get(contact.id);
  if (attributedTo) return attributedTo.has(businessId);
  return (attribution.companyCount.get(contact.personId) ?? 0) <= 1;
};

export type ContactAttributionStatus = 'THIS_COMPANY' | 'SHARED' | 'OTHER_COMPANY' | 'UNATTRIBUTED';

export interface IContactAttributionView {
  /**
   * THIS_COMPANY  - reported only for this role's company.
   * SHARED        - reported for this company and at least one other.
   * OTHER_COMPANY - reported only for other companies, never this one.
   * UNATTRIBUTED  - no observation attributes it to any company (reviewer-added, or imported before observations were recorded).
   * Nothing is inferred from the value, the name, the title or the company name: only the recorded observation claims count.
   */
  status: ContactAttributionStatus;
  /** The customer rule applied to this company: may this contact be shown on this company's cards (once published and the role is visible)? */
  eligibleForThisCompany: boolean;
}

/** The reviewer-facing reading of the SAME decision the customer surfaces make (isContactEligibleForCompany). Read-only; it changes nothing. */
export const contactAttributionStatus = (contact: { id: string; personId: string }, businessId: string, attribution: IContactAttribution): IContactAttributionView => {
  const attributedTo = attribution.businessesByContact.get(contact.id);
  const status: ContactAttributionStatus = !attributedTo ? 'UNATTRIBUTED' : !attributedTo.has(businessId) ? 'OTHER_COMPANY' : attributedTo.size > 1 ? 'SHARED' : 'THIS_COMPANY';
  return { status, eligibleForThisCompany: isContactEligibleForCompany(contact, businessId, attribution) };
};

/** The contacts of a person that may be shown on a role at one company. Existing primary / confidence selection then applies to this list. */
export const contactsForCompany = <T extends { id: string; personId: string }>(contacts: T[], businessId: string, attribution: IContactAttribution): T[] =>
  contacts.filter((c) => isContactEligibleForCompany(c, businessId, attribution));

/** The contacts that may be shown at at least one of the given (customer-visible) companies: the person-level view. */
export const contactsForAnyCompany = <T extends { id: string; personId: string }>(contacts: T[], businessIds: string[], attribution: IContactAttribution): T[] =>
  contacts.filter((c) => businessIds.some((b) => isContactEligibleForCompany(c, b, attribution)));

/**
 * The same rule as a SQL predicate, for queries that cannot load rows (discover's "has a decision-maker contact").
 * `contact` and `role` are the SQL aliases of person_contacts and company_people in the surrounding query.
 */
export const contactEligibleForRoleSql = (contact: string, role: string): SQL => {
  const c = sql.raw(contact);
  const r = sql.raw(role);
  return sql`(
    EXISTS (SELECT 1 FROM people_observation_claims oc JOIN people_observations ob ON ob.id = oc.observation_id JOIN company_people att ON att.id = ob.company_person_id WHERE oc.contact_id = ${c}.id AND att.business_id = ${r}.business_id)
    OR (
      NOT EXISTS (SELECT 1 FROM people_observation_claims oc JOIN people_observations ob ON ob.id = oc.observation_id WHERE oc.contact_id = ${c}.id AND ob.company_person_id IS NOT NULL)
      AND (SELECT count(DISTINCT rel.business_id) FROM company_people rel WHERE rel.person_id = ${c}.person_id) <= 1
    )
  )`;
};
