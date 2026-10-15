import { BUILT_IN_SOURCE_KEYS } from '../../sources/built-in-sources';
import type { IPeopleSource, IRawPersonRecord } from '../ingestion.types';

/** Structured JSON (already in the raw record shape). */
export class JsonPeopleSource implements IPeopleSource {
  constructor(
    readonly name: string,
    private readonly data: IRawPersonRecord[],
    /** Registry key (Phase 6.1). The built-in JSON source is registered by migration 0009. */
    readonly sourceKey: string = BUILT_IN_SOURCE_KEYS.JSON,
  ) {}

  records(): Iterable<IRawPersonRecord> {
    return this.data;
  }
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, embedded commas/newlines, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  business_id: 'businessId',
  company_id: 'businessId',
  business_slug: 'businessSlug',
  company_slug: 'businessSlug',
  cin: 'cin',
  gstin: 'gstin',
  pan: 'pan',
  udyam: 'udyam',
  person_name: 'personName',
  name: 'personName',
  full_name: 'personName',
  job_title: 'jobTitle',
  title: 'jobTitle',
  designation: 'jobTitle',
  department: 'department',
  seniority: 'seniority',
  decision_maker_type: 'decisionMakerType',
  email: 'email',
  work_email: 'email',
  phone: 'phone',
  work_phone: 'phone',
  mobile: 'mobile',
  mobile_phone: 'mobile',
  linkedin: 'linkedinUrl',
  linkedin_url: 'linkedinUrl',
  location: 'location',
  city: 'city',
  state: 'state',
  country: 'country',
  is_current: 'isCurrent',
  start_date: 'startDate',
  end_date: 'endDate',
  confidence: 'confidenceScore',
  confidence_score: 'confidenceScore',
  source_type: 'source.type',
  source: 'source.type',
  source_label: 'source.label',
  source_url: 'source.url',
  source_reference: 'source.reference',
  source_record_id: 'source.recordId',
  payload_ref: 'source.payloadRef',
  evidence_type: 'source.evidenceType',
  observed_at: 'source.observedAt',
  verification_status: 'verification.status',
  verified_at: 'verification.verifiedAt',
  verified_by: 'verification.verifiedBy',
};

/**
 * CSV rows -> raw records. Header names are matched case-insensitively (spaces/dashes as
 * underscores). Unknown columns are ignored. Empty cells stay undefined: nothing is defaulted.
 */
export class CsvPeopleSource implements IPeopleSource {
  constructor(
    readonly name: string,
    private readonly csv: string,
    /** Registry key (Phase 6.1). The built-in CSV source is registered by migration 0009. */
    readonly sourceKey: string = BUILT_IN_SOURCE_KEYS.CSV,
  ) {}

  records(): Iterable<IRawPersonRecord> {
    const [header, ...rows] = parseCsv(this.csv);
    if (!header) return [];
    const keys = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, '_')]);
    return rows.map((cells) => {
      const rec: Record<string, any> = {};
      keys.forEach((key, i) => {
        const value = (cells[i] ?? '').trim();
        if (!key || value === '') return;
        if (['cin', 'gstin', 'pan', 'udyam'].includes(key)) {
          rec.businessIdentifier = { type: key.toUpperCase(), value };
        } else if (key.includes('.')) {
          const [group, field] = key.split('.');
          rec[group] = { ...(rec[group] ?? {}), [field]: value };
        } else if (key === 'confidenceScore') {
          rec[key] = Number(value);
        } else rec[key] = value;
      });
      return rec as IRawPersonRecord;
    });
  }
}
