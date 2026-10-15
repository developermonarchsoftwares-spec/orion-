import type { IRawPersonRecord, IReason } from '../ingestion/ingestion.types';
import {
  INewSource,
  ISourcePermissions,
  ISourcePolicy,
  MAX_ATTESTATION_LEVELS,
  MaxAttestation,
  PERMISSION_KEYS,
  SOURCE_COST_CLASSES,
  SOURCE_TYPES,
  SourceType,
} from './source.types';

/**
 * Pure source-policy logic: validation of definitions and the gate every record from a keyed source passes before the
 * normal ingestion pipeline sees it. No database, no I/O.
 */

// ------------------------------------------------------------------------------------------------ definitions

export const SOURCE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,58}$/;

/** Internal, human-supplied source types may be unrestricted about evidence types; external ones must list them. */
export const UNRESTRICTED_EVIDENCE_ALLOWED: readonly SourceType[] = ['MANUAL_IMPORT', 'USER_SUBMISSION'];

const SECRET_KEY = /(api[-_]?key|secret|token|passw(or)?d|credential|authorization|bearer|private[-_]?key|access[-_]?key)/i;
const SECRET_VALUE = /(^|[\s=:"'])(bearer\s+\S+|sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.)|(api[-_]?key|secret|token|passw(or)?d)\s*[=:]\s*\S+/i;

/** Registry rows hold no secrets: refuse anything that looks like a credential, by key name or by value shape. */
export function findSecretLikeContent(value: unknown, path = ''): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return SECRET_VALUE.test(value.trim()) ? `${path || 'value'} looks like a credential` : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecretLikeContent(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) return `${path ? path + '.' : ''}${k} is a credential-like field`;
      const hit = findSecretLikeContent(v, `${path ? path + '.' : ''}${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

/** Validates registration input and returns normalised policy (every permission explicit, deny by default). */
export function buildPolicy(input: INewSource['policy'], sourceType: SourceType): ISourcePolicy {
  const permissions = {} as ISourcePermissions;
  for (const key of Object.keys(input.permissions ?? {})) {
    if (!(PERMISSION_KEYS as readonly string[]).includes(key)) throw new PolicyError(`Unknown permission "${key}"`, 'INVALID_SOURCE_POLICY');
  }
  for (const key of PERMISSION_KEYS) {
    const v = input.permissions?.[key];
    if (v !== undefined && typeof v !== 'boolean') throw new PolicyError(`Permission "${key}" must be true or false`, 'INVALID_SOURCE_POLICY');
    permissions[key] = v === true;
  }
  const maxAttestation: MaxAttestation = input.maxAttestation ?? 'NONE';
  if (!(MAX_ATTESTATION_LEVELS as readonly string[]).includes(maxAttestation)) throw new PolicyError(`Unknown attestation level "${maxAttestation}"`, 'INVALID_SOURCE_POLICY');
  if (maxAttestation !== 'NONE' && !permissions.attestation) {
    throw new PolicyError('maxAttestation above NONE requires the attestation permission', 'INVALID_SOURCE_POLICY');
  }
  const allowed = input.allowedEvidenceTypes === undefined ? null : input.allowedEvidenceTypes;
  if (allowed !== null) {
    if (!Array.isArray(allowed) || allowed.some((t) => typeof t !== 'string' || !/^[A-Z][A-Z0-9_]{1,39}$/.test(t))) {
      throw new PolicyError('allowedEvidenceTypes must be a list of UPPER_SNAKE evidence types', 'INVALID_SOURCE_POLICY');
    }
  } else if (!UNRESTRICTED_EVIDENCE_ALLOWED.includes(sourceType)) {
    throw new PolicyError(`A ${sourceType} source must list its allowed evidence types`, 'INVALID_SOURCE_POLICY');
  }
  return { permissions, enforceSourceType: input.enforceSourceType === true, allowedEvidenceTypes: allowed ? [...new Set(allowed)].sort() : null, maxAttestation };
}

export function validateNewSource(input: INewSource): { policy: ISourcePolicy } {
  if (!SOURCE_KEY_PATTERN.test(input.key ?? '')) throw new PolicyError('Source key must be 2-59 characters: lower-case letters, digits, dot, dash, underscore', 'INVALID_SOURCE_KEY');
  if (!input.displayName?.trim() || input.displayName.length > 120) throw new PolicyError('displayName is required (max 120 characters)', 'INVALID_SOURCE');
  if (!(SOURCE_TYPES as readonly string[]).includes(input.sourceType)) throw new PolicyError(`Unknown source type "${input.sourceType}"`, 'INVALID_SOURCE_TYPE');
  if (input.version !== undefined && (!input.version.trim() || input.version.length > 20)) throw new PolicyError('version must be 1-20 characters', 'INVALID_SOURCE');
  if (input.costClass !== undefined && !(SOURCE_COST_CLASSES as readonly string[]).includes(input.costClass)) throw new PolicyError('Unknown cost class', 'INVALID_SOURCE');
  if (input.freshnessTtlDays !== undefined && input.freshnessTtlDays !== null && (!Number.isInteger(input.freshnessTtlDays) || input.freshnessTtlDays <= 0)) {
    throw new PolicyError('freshnessTtlDays must be a positive whole number of days', 'INVALID_SOURCE');
  }
  if (input.enabled && !input.termsAcknowledged) throw new PolicyError('A source cannot be enabled before its licence / terms are acknowledged', 'SOURCE_TERMS_NOT_ACKNOWLEDGED');
  const secret = findSecretLikeContent({ displayName: input.displayName, termsReference: input.termsReference, policy: input.policy });
  if (secret) throw new PolicyError(`Registry rows must not contain credentials: ${secret}`, 'SOURCE_SECRET_REJECTED');
  return { policy: buildPolicy(input.policy, input.sourceType) };
}

export class PolicyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------------------------------------ record gate

/** Fields no source may supply: they are decided by review, verification and publishing, never by data. */
const FORBIDDEN_FIELDS = new Set([
  'verificationstatus', 'reviewstatus', 'ispublished', 'published', 'datastatus', 'approvalstatus', 'approved',
  'reviewedby', 'reviewedat', 'reviewnote', 'reviewerid', 'publishedat', 'classificationsource',
]);
const normKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Finds forbidden keys on the record and on its nested `source` / `verification` objects. */
export function findForbiddenFields(raw: unknown): string[] {
  const found: string[] = [];
  const scan = (obj: unknown, prefix: string) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN_FIELDS.has(normKey(k))) found.push(prefix + k);
      if (k === 'source' || k === 'verification') scan(v, `${k}.`);
    }
  };
  scan(raw, '');
  return found;
}

export interface IPolicyResult {
  /** The record to hand on to normalisation. Never the same object as the input. */
  record: IRawPersonRecord;
  warnings: IReason[];
  /** Any violation rejects the record (it is quarantined, never partly written). */
  violations: IReason[];
}

const has = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/**
 * Applies a source's policy to ONE record. Rules:
 *  - forbidden fields (verification/review/publication state) => violation
 *  - identity / title not permitted => violation (the record would be meaningless)
 *  - email / phone / mobile / LinkedIn not permitted => field removed + warning
 *  - evidence details not permitted => removed + warning; evidence type not in the allowed list => violation
 *  - enforceSourceType => the registered type replaces the claimed one
 *  - attestation: not permitted => removed; above maxAttestation => capped down (never up) + warning
 */
export function applySourcePolicy(
  policy: ISourcePolicy,
  registeredType: SourceType,
  raw: IRawPersonRecord,
): IPolicyResult {
  const warnings: IReason[] = [];
  const violations: IReason[] = [];
  const record: IRawPersonRecord = { ...(raw ?? {}), ...(raw?.source ? { source: { ...raw.source } } : {}), ...(raw?.verification ? { verification: { ...raw.verification } } : {}) };
  const p = policy.permissions;

  for (const f of findForbiddenFields(raw)) {
    violations.push({ code: 'SOURCE_FORBIDDEN_FIELD', message: `A source cannot supply "${f}": review, verification and publication state are not set by data` });
  }

  if (has(record.personName) && !p.identity) violations.push({ code: 'SOURCE_NOT_PERMITTED', message: 'This source is not permitted to provide person identity' });
  if (has(record.jobTitle) && !p.title) violations.push({ code: 'SOURCE_NOT_PERMITTED', message: 'This source is not permitted to provide job titles' });

  const strip = (field: keyof IRawPersonRecord, allowed: boolean, label: string) => {
    if (has(record[field]) && !allowed) {
      delete (record as unknown as Record<string, unknown>)[field as string];
      warnings.push({ code: `SOURCE_FIELD_NOT_PERMITTED:${label}`, message: `This source may not provide ${label}; the value was dropped` });
    }
  };
  strip('email', p.email, 'email');
  strip('phone', p.phone, 'phone');
  strip('mobile', p.phone, 'mobile');
  strip('linkedinUrl', p.linkedin, 'linkedin');

  if (record.source) {
    if (!p.evidence) {
      let dropped = false;
      for (const f of ['url', 'reference', 'evidenceType', 'observedAt'] as const) {
        if (has(record.source[f])) {
          delete record.source[f];
          dropped = true;
        }
      }
      if (dropped) warnings.push({ code: 'SOURCE_FIELD_NOT_PERMITTED:evidence', message: 'This source may not provide evidence details; they were dropped' });
    }
    if (policy.enforceSourceType) {
      if (has(record.source.type) && String(record.source.type).toUpperCase() !== registeredType) {
        warnings.push({ code: 'SOURCE_TYPE_OVERRIDDEN', message: `The record claimed type ${record.source.type}; this source is registered as ${registeredType}` });
      }
      record.source.type = registeredType;
    }
  }

  if (policy.allowedEvidenceTypes) {
    const evidenceType = String(record.source?.evidenceType ?? 'ROLE_CLAIM').trim().toUpperCase().replace(/\s+/g, '_');
    if (!policy.allowedEvidenceTypes.includes(evidenceType)) {
      violations.push({ code: 'SOURCE_EVIDENCE_TYPE_NOT_ALLOWED', message: `Evidence type ${evidenceType} is not allowed for this source (allowed: ${policy.allowedEvidenceTypes.join(', ')})` });
    }
  }

  if (record.verification && has(record.verification.status)) {
    const status = String(record.verification.status).trim().toUpperCase();
    const cap: MaxAttestation = p.attestation ? policy.maxAttestation : 'NONE';
    if (status === 'VERIFIED' || status === 'PARTIALLY_VERIFIED') {
      if (cap === 'NONE') {
        delete record.verification;
        warnings.push({ code: 'SOURCE_ATTESTATION_CAPPED', message: 'This source may not attest; the verification claim was dropped' });
      } else if (cap === 'PARTIAL' && status === 'VERIFIED') {
        record.verification.status = 'PARTIALLY_VERIFIED';
        warnings.push({ code: 'SOURCE_ATTESTATION_CAPPED', message: 'The source claimed VERIFIED; its maximum attestation is PARTIAL' });
      }
    } else if (!p.attestation) {
      delete record.verification; // a conflict report is also an attestation-class claim
      warnings.push({ code: 'SOURCE_ATTESTATION_CAPPED', message: 'This source may not send verification information; it was dropped' });
    }
  } else if (record.verification && !p.attestation) {
    delete record.verification;
  }

  return { record, warnings, violations };
}
