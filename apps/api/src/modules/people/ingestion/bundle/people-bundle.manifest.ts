import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../../common/errors/business.exception';
import { OBSERVATION_LIMITS } from '../../observations/observation-policy';
import { PEOPLE_EXPORT_VERSION } from '../sources/people-export.mapper';

/**
 * The People Pipeline's Phase 9B split-export bundle, exactly as the Pipeline produces it:
 *
 *   <orion_published_people_<UTC ts>_<8 hex>_split.zip>
 *     manifest.json                                          first member
 *     orion_published_people_<ts>_<8 hex>_part-0001-of-000N.csv|json   in part order, nothing else
 *
 * manifest.json: { export_version, exported_at, bundle_id, format, max_part_rows, total_rows, part_count,
 *                  parts: [{ part_number, filename, row_count, bytes, sha256 }] }
 *
 * There is no second manifest format: a manifest with a missing, extra or differently typed field is refused, not interpreted.
 * Nothing here knows about people; a part is imported by the existing People export importer, unchanged.
 */
export const BUNDLE_LIMITS = {
  /** The ZIP file itself. As base64 inside the JSON body this stays below the route's 20 MB body limit. */
  MAX_ZIP_BYTES: 11 * 1024 * 1024,
  /** The People Pipeline's own limits (MAX_PARTS, MAX_PART_BYTES) and Orion's per-file row limit. */
  MAX_PARTS: 500,
  MAX_PART_BYTES: 15 * 1024 * 1024,
  MAX_PART_ROWS: OBSERVATION_LIMITS.MAX_RECORDS_PER_RUN,
  MAX_MANIFEST_BYTES: 1024 * 1024,
  /** Sum of all uncompressed entries: the Pipeline's 50,000-row export cap at a generous row size. */
  MAX_TOTAL_BYTES: 64 * 1024 * 1024,
  /** The Pipeline's export cap. */
  MAX_TOTAL_ROWS: 50_000,
} as const;

export const MANIFEST_NAME = 'manifest.json';
export type BundleFormat = 'csv' | 'json';

export interface IBundleManifestPart {
  part_number: number;
  filename: string;
  row_count: number;
  bytes: number;
  sha256: string;
}
export interface IBundleManifest {
  export_version: string;
  exported_at: string;
  bundle_id: string;
  format: BundleFormat;
  max_part_rows: number;
  total_rows: number;
  part_count: number;
  parts: IBundleManifestPart[];
}

/** A refusal of a whole bundle: a machine code, a sentence without any file content, and optionally the part it concerns. */
export class BundleError extends BusinessException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, details?: Record<string, unknown>) {
    super(message, code, status, details);
  }
}

const TOP_KEYS = ['export_version', 'exported_at', 'bundle_id', 'format', 'max_part_rows', 'total_rows', 'part_count', 'parts'];
const PART_KEYS = ['part_number', 'filename', 'row_count', 'bytes', 'sha256'];
const BUNDLE_ID = /^(\d{8}T\d{6}Z)-([0-9a-f]{12})$/;
const PART_FILE = /^orion_published_people_(\d{8}T\d{6}Z)_([0-9a-f]{8})_part-(\d{4})-of-(\d{4})\.(csv|json)$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const bad = (message: string, details?: Record<string, unknown>) => new BundleError('BUNDLE_MANIFEST_MALFORMED', message, HttpStatus.BAD_REQUEST, details);

export function parseManifest(bytes: Buffer): IBundleManifest {
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw bad('manifest.json is not valid JSON');
  }
  return validateManifest(doc);
}

export function validateManifest(doc: unknown): IBundleManifest {
  if (!isObj(doc)) throw bad('manifest.json must be a JSON object');
  const extra = Object.keys(doc).filter((k) => !TOP_KEYS.includes(k));
  const missing = TOP_KEYS.filter((k) => !(k in doc));
  if (missing.length || extra.length) throw bad('manifest.json does not match the People Pipeline bundle format', { missing, unexpected: extra.slice(0, 5) });

  if (doc.export_version !== PEOPLE_EXPORT_VERSION) {
    throw new BundleError('BUNDLE_UNSUPPORTED_EXPORT_VERSION', `Unsupported export_version; this import accepts version "${PEOPLE_EXPORT_VERSION}"`);
  }
  if (doc.format !== 'csv' && doc.format !== 'json') throw new BundleError('BUNDLE_UNSUPPORTED_FORMAT', 'The bundle format must be "csv" or "json"');
  if (typeof doc.exported_at !== 'string' || Number.isNaN(Date.parse(doc.exported_at))) throw bad('exported_at is not a valid date');
  if (Date.parse(doc.exported_at) > Date.now() + 86_400_000) throw bad('exported_at is in the future');
  const idMatch = typeof doc.bundle_id === 'string' ? BUNDLE_ID.exec(doc.bundle_id) : null;
  if (!idMatch) throw bad('bundle_id is not a valid bundle identifier');
  if (!isInt(doc.max_part_rows, 1, BUNDLE_LIMITS.MAX_PART_ROWS)) throw bad(`max_part_rows must be an integer from 1 to ${BUNDLE_LIMITS.MAX_PART_ROWS}`);
  if (!isInt(doc.total_rows, 0, BUNDLE_LIMITS.MAX_TOTAL_ROWS)) throw bad('total_rows is not valid');
  if (!isInt(doc.part_count, 0, BUNDLE_LIMITS.MAX_PARTS)) {
    throw new BundleError('BUNDLE_TOO_MANY_PARTS', `A bundle has at most ${BUNDLE_LIMITS.MAX_PARTS} parts`);
  }
  if (!Array.isArray(doc.parts)) throw bad('parts must be a list');
  if (doc.parts.length !== doc.part_count) throw new BundleError('BUNDLE_PART_COUNT_MISMATCH', 'part_count does not match the number of parts listed');

  const parts: IBundleManifestPart[] = [];
  let rows = 0;
  doc.parts.forEach((p: unknown, i: number) => {
    const where = { partNumber: i + 1 };
    if (!isObj(p)) throw bad('Every part entry must be an object', where);
    const keysOk = PART_KEYS.every((k) => k in p) && Object.keys(p).every((k) => PART_KEYS.includes(k));
    if (!keysOk) throw bad('A part entry does not match the People Pipeline bundle format', where);
    if (p.part_number !== i + 1) throw new BundleError('BUNDLE_PART_ORDER_MISMATCH', 'The parts are not numbered 1..N in order', HttpStatus.BAD_REQUEST, where);
    const f = typeof p.filename === 'string' ? PART_FILE.exec(p.filename) : null;
    if (!f) throw bad('A part filename is not a People Pipeline part name', where);
    const [, ts, hex8, num, of, ext] = f;
    if (ts !== idMatch[1] || !idMatch[2].startsWith(hex8) || Number(num) !== i + 1 || Number(of) !== doc.part_count || ext !== doc.format) {
      throw bad('A part filename does not belong to this bundle', where);
    }
    if (!isInt(p.row_count, 1, Math.min(doc.max_part_rows as number, BUNDLE_LIMITS.MAX_PART_ROWS))) throw bad('A part row_count is not valid', where);
    if (!isInt(p.bytes, 1, BUNDLE_LIMITS.MAX_PART_BYTES)) throw bad('A part byte count is not valid', where);
    if (typeof p.sha256 !== 'string' || !SHA256.test(p.sha256)) throw bad('A part sha256 is not valid', where);
    rows += p.row_count;
    parts.push({ part_number: i + 1, filename: p.filename as string, row_count: p.row_count, bytes: p.bytes, sha256: p.sha256 });
  });
  if (rows !== doc.total_rows) throw new BundleError('BUNDLE_TOTAL_ROWS_MISMATCH', 'total_rows does not equal the sum of the part row counts');

  return {
    export_version: doc.export_version,
    exported_at: doc.exported_at,
    bundle_id: doc.bundle_id as string,
    format: doc.format,
    max_part_rows: doc.max_part_rows as number,
    total_rows: doc.total_rows as number,
    part_count: doc.part_count as number,
    parts,
  };
}
