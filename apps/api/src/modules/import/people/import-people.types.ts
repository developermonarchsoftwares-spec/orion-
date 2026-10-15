/**
 * Report shape for the People ingestion stage of a company upload. Stored on the existing
 * import rows (`import_records.people_result`, `import_batches.people_summary`); there is no
 * separate reporting system.
 *
 * Invariant: received = accepted + rejected + quarantined + errors, and
 * accepted = created + updated + unchanged.
 */
export interface IPeopleIngestionSummary {
  /** Person entries found on the uploaded company row(s). */
  received: number;
  /** Stored by the People layer (created + updated + unchanged). */
  accepted: number;
  /** New people created (always DRAFT). */
  created: number;
  /** Existing people that gained/changed a role, contact or evidence. */
  updated: number;
  /** Already known; nothing changed (idempotent re-ingestion). */
  unchanged: number;
  /** Held in the People quarantine for identity/company reasons (ambiguous, suppressed, unknown company). */
  quarantined: number;
  /** Refused because the person data itself was invalid (missing/bad name, title, provenance, dates...). Also in the quarantine table. */
  rejected: number;
  /** Person entries lost because People ingestion itself failed (the company import is unaffected). */
  errors: number;
}

export type ImportPeopleSkipReason = 'DISABLED' | 'NOT_CONFIGURED' | 'NO_PEOPLE';

export interface IImportPeopleResult extends IPeopleIngestionSummary {
  attempted: boolean;
  skipped?: ImportPeopleSkipReason;
  /** Per person: outcome and machine-readable reason codes only (no personal data). */
  outcomes: Array<{ index: number; outcome: string; personId?: string; codes?: string[] }>;
  /** Set when ingestion failed as a whole. */
  error?: string;
}

/**
 * The people columns the upload reads (see extractPeopleFromRow). Person 1 uses the existing
 * contact_person / contact_title columns plus person_email/phone/mobile/linkedin; extra people use
 * person_<n>_* for n = 2..5 (the template lists 2 and 3; 4 and 5 follow the same pattern).
 * Company-level columns (email, phone, website, ...) are NEVER attributed to a person.
 */
export const PERSON_FIELD_SUFFIXES = ['name', 'title', 'email', 'phone', 'mobile', 'linkedin'] as const;
export const PERSON_1_TEMPLATE_COLUMNS = ['person_email', 'person_phone', 'person_mobile', 'person_linkedin'] as const;
export const EXTRA_PERSON_TEMPLATE_COLUMNS = [2, 3].flatMap((n) => PERSON_FIELD_SUFFIXES.map((f) => `person_${n}_${f}`));
export const PEOPLE_TEMPLATE_COLUMNS: string[] = [...PERSON_1_TEMPLATE_COLUMNS, ...EXTRA_PERSON_TEMPLATE_COLUMNS];

export const emptyPeopleSummary =(): IPeopleIngestionSummary => ({
  received: 0,
  accepted: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  quarantined: 0,
  rejected: 0,
  errors: 0,
});

export const emptyPeopleResult = (skipped?: ImportPeopleSkipReason): IImportPeopleResult => ({
  ...emptyPeopleSummary(),
  attempted: false,
  skipped,
  outcomes: [],
});
