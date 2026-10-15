import { createHash } from 'crypto';
import type { IRawPersonRecord, IReason } from '../ingestion/ingestion.types';
import { findSecretLikeContent } from '../sources/source-policy';

/**
 * Observation policy (Phase 6.2): limits, safe serialisation, source-record key validation, content fingerprints.
 * Pure: no database, no I/O.
 *
 * The limits below are TECHNICAL SAFETY BOUNDARIES (not business policy): they keep one hostile or broken source from
 * exhausting storage or memory. They apply to keyed (registered) sources; legacy unkeyed callers are unchanged.
 */
export const OBSERVATION_LIMITS = {
  /** Serialised size of one mapped record. */
  MAX_RECORD_BYTES: 16 * 1024,
  /** Records accepted in one keyed ingestion run. */
  MAX_RECORDS_PER_RUN: 10_000,
  MAX_DEPTH: 8,
  MAX_KEYS_PER_OBJECT: 100,
  MAX_ARRAY_LENGTH: 100,
  MAX_SOURCE_RECORD_ID: 200,
  MAX_PAYLOAD_REF: 255,
  /** Stored raw copy of a quarantined record; larger records are replaced by a stub (size + fingerprint only). */
  MAX_QUARANTINE_RAW_BYTES: 16 * 1024,
} as const;

export class ObservationInputError extends Error {
  constructor(
    message: string,
    readonly code: 'MALFORMED_RECORD' | 'RECORD_TOO_LARGE',
  ) {
    super(message);
  }
}

/**
 * Deterministic, bounded serialisation of untrusted data. Only plain JSON-like values are accepted: functions, symbols,
 * bigint, non-plain objects and cycles are refused, depth / breadth are capped, and nothing is ever evaluated.
 */
export function canonicalize(value: unknown, depth = 0): string {
  if (depth > OBSERVATION_LIMITS.MAX_DEPTH) throw new ObservationInputError('Record is nested too deeply (or cyclic)', 'MALFORMED_RECORD');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      // NUL cannot be stored by PostgreSQL (jsonb / text) and is never legitimate in a person record
      if (value.includes('\u0000')) throw new ObservationInputError('Record contains a NUL character', 'MALFORMED_RECORD');
      return JSON.stringify(value.normalize('NFC'));
    case 'number':
      if (!Number.isFinite(value)) throw new ObservationInputError('Record contains a non-finite number', 'MALFORMED_RECORD');
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'undefined':
      return 'null';
    case 'object':
      break;
    default:
      throw new ObservationInputError(`Record contains an unsupported value (${typeof value})`, 'MALFORMED_RECORD');
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ObservationInputError('Record contains an invalid date', 'MALFORMED_RECORD');
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    if (value.length > OBSERVATION_LIMITS.MAX_ARRAY_LENGTH) throw new ObservationInputError('Record contains an oversized list', 'RECORD_TOO_LARGE');
    return `[${value.map((v) => canonicalize(v, depth + 1)).join(',')}]`;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new ObservationInputError('Record contains a non-plain object', 'MALFORMED_RECORD');
  const keys = Object.keys(value as object).sort();
  if (keys.some((k) => k.includes('\u0000'))) throw new ObservationInputError('Record contains a NUL character', 'MALFORMED_RECORD');
  if (keys.length > OBSERVATION_LIMITS.MAX_KEYS_PER_OBJECT) throw new ObservationInputError('Record has too many fields', 'RECORD_TOO_LARGE');
  const parts: string[] = [];
  for (const k of keys) {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) continue; // absent and undefined are the same thing
    parts.push(`${JSON.stringify(k)}:${canonicalize(v, depth + 1)}`);
  }
  return `{${parts.join(',')}}`;
}

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface IMeasured {
  /** Serialised size in bytes of the record as received (provenance timestamps included). */
  bytes: number;
  /**
   * Fingerprint of what the record SAYS, not of when we saw it: the source-reported observed date is excluded so the same
   * content seen again (with a newer date) is recognisably the same content. Changing any claimed value changes it.
   */
  contentFingerprint: string;
}

/** Size-checks and fingerprints a mapped record. Throws ObservationInputError for malformed or oversized input. */
export function measureRecord(raw: IRawPersonRecord): IMeasured {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ObservationInputError('A record must be an object', 'MALFORMED_RECORD');
  const full = canonicalize(raw);
  const bytes = Buffer.byteLength(full, 'utf8');
  if (bytes > OBSERVATION_LIMITS.MAX_RECORD_BYTES) {
    throw new ObservationInputError(`Record is ${bytes} bytes; the limit is ${OBSERVATION_LIMITS.MAX_RECORD_BYTES}`, 'RECORD_TOO_LARGE');
  }
  const { observedAt: _ignored, ...source } = (raw.source ?? {}) as Record<string, unknown>;
  void _ignored;
  const content = canonicalize({ ...raw, source: raw.source ? source : undefined });
  return { bytes, contentFingerprint: sha256(content) };
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

export interface IObservationFields {
  sourceRecordId?: string;
  payloadRef?: string;
  observedAt: Date | null;
  violations: IReason[];
}

/** Validates the observation-related provenance fields of a record: record id, payload reference, observed date, secrets. */
export function readObservationFields(raw: IRawPersonRecord): IObservationFields {
  const violations: IReason[] = [];
  const src = (raw?.source ?? {}) as Record<string, unknown>;
  let sourceRecordId: string | undefined;
  if (src.recordId !== undefined && src.recordId !== null && String(src.recordId).trim() !== '') {
    const id = String(src.recordId).trim();
    if (id.length > OBSERVATION_LIMITS.MAX_SOURCE_RECORD_ID || CONTROL_CHARS.test(id)) {
      violations.push({ code: 'INVALID_SOURCE_RECORD_ID', message: `source.recordId must be 1-${OBSERVATION_LIMITS.MAX_SOURCE_RECORD_ID} printable characters` });
    } else sourceRecordId = id;
  }
  let payloadRef: string | undefined;
  if (src.payloadRef !== undefined && src.payloadRef !== null && String(src.payloadRef).trim() !== '') {
    const ref = String(src.payloadRef).trim();
    if (ref.length > OBSERVATION_LIMITS.MAX_PAYLOAD_REF || CONTROL_CHARS.test(ref) || /\s/.test(ref)) {
      violations.push({ code: 'INVALID_PAYLOAD_REF', message: `source.payloadRef must be a reference of at most ${OBSERVATION_LIMITS.MAX_PAYLOAD_REF} characters without whitespace` });
    } else payloadRef = ref;
  }
  // Provenance fields must never carry credentials (for example an API key in a URL query or userinfo).
  for (const field of ['url', 'reference', 'label', 'payloadRef', 'recordId']) {
    const v = src[field];
    if (typeof v === 'string') {
      const hit = findSecretLikeContent({ [field]: v }) ?? (/^[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i.test(v) ? `${field} contains URL credentials` : null);
      if (hit) violations.push({ code: 'SOURCE_SECRET_REJECTED', message: `Provenance must not contain credentials: ${hit}` });
    }
  }
  let observedAt: Date | null = null;
  if (src.observedAt !== undefined && src.observedAt !== null && String(src.observedAt).trim() !== '') {
    const d = src.observedAt instanceof Date ? src.observedAt : new Date(String(src.observedAt));
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 5 * 60_000) observedAt = d;
  }
  return { sourceRecordId, payloadRef, observedAt, violations };
}

/**
 * What is safe to keep of a quarantined record. Small, serialisable records are stored as received (reviewers need them);
 * anything oversized or malformed is replaced by a stub that says so, so quarantine can never be used to store bulk or
 * unserialisable data, or to crash a run.
 */
export function safeQuarantineRaw(raw: unknown): { raw: Record<string, unknown>; fingerprintSource: string; stubbed: boolean } {
  try {
    const text = canonicalize(raw);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes <= OBSERVATION_LIMITS.MAX_QUARANTINE_RAW_BYTES && raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { raw: raw as Record<string, unknown>, fingerprintSource: text, stubbed: false };
    }
    return { raw: { _stub: true, reason: 'RECORD_TOO_LARGE_OR_NOT_AN_OBJECT', bytes, sha256: sha256(text) }, fingerprintSource: text, stubbed: true };
  } catch (err) {
    const why = err instanceof ObservationInputError ? err.code : 'UNSERIALISABLE';
    return { raw: { _stub: true, reason: why }, fingerprintSource: `unserialisable:${why}`, stubbed: true };
  }
}
