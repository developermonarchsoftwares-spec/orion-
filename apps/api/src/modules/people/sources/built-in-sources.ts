import type { ISourcePolicy } from './source.types';

/**
 * The sources that already exist in the codebase, registered by migration 0009. There are no external providers here.
 * Keys are stable identifiers: never rename or reuse one.
 */
export const BUILT_IN_SOURCE_KEYS = {
  CSV: 'people-csv',
  JSON: 'people-json',
  COMPANY_UPLOAD: 'company-upload',
} as const;

/** Today's behaviour, expressed as policy: everything permitted, unrestricted evidence types, attestation up to FULL. */
export const LEGACY_INTERNAL_POLICY: ISourcePolicy = {
  permissions: { identity: true, title: true, email: true, phone: true, linkedin: true, evidence: true, attestation: true },
  enforceSourceType: false,
  allowedEvidenceTypes: null,
  maxAttestation: 'FULL',
};

/** Mirrors the migration seed; a test keeps the two identical. */
export const BUILT_IN_SOURCES = [
  { key: BUILT_IN_SOURCE_KEYS.CSV, displayName: 'People CSV import', sourceType: 'MANUAL_IMPORT', version: '1' },
  { key: BUILT_IN_SOURCE_KEYS.JSON, displayName: 'People JSON ingestion', sourceType: 'MANUAL_IMPORT', version: '1' },
  { key: BUILT_IN_SOURCE_KEYS.COMPANY_UPLOAD, displayName: 'Company upload (People bridge)', sourceType: 'MANUAL_IMPORT', version: '1' },
] as const;
