import { createHash, randomBytes } from 'crypto';
import { deflateRawSync } from 'zlib';
import { crc32 } from '../ingestion/bundle/safe-zip';
import { exportRow, ExportRowInput, toCsv, toJson } from './people-export-fixtures';

/** One ZIP entry, with optional deliberate lies so the reader can be tested against hostile archives. */
export interface IZipSpec {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  /** Overrides for crafted archives. */
  declaredUsize?: number;
  declaredCsize?: number;
  declaredCrc?: number;
  localName?: string;
  flags?: number;
  /** Already-compressed bytes to store as-is (so the declared sizes can disagree with the real ones). */
  rawCompressed?: Buffer;
}

/** A minimal ZIP writer (central directory included), only for tests. */
export function buildZip(entries: IZipSpec[], opts: { comment?: string; eocdEntries?: number } = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const comp = e.rawCompressed ?? (method === 8 ? deflateRawSync(e.data) : e.data);
    const crc = e.declaredCrc ?? crc32(e.data);
    const usize = e.declaredUsize ?? e.data.length;
    const csize = e.declaredCsize ?? comp.length;
    const name = Buffer.from(e.name, 'utf8');
    const lname = Buffer.from(e.localName ?? e.name, 'utf8');
    const flags = e.flags ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(csize, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(lname.length, 26);
    const localBuf = Buffer.concat([local, lname, comp]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(csize, 20); central.writeUInt32LE(usize, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, name]));
    locals.push(localBuf);
    offset += localBuf.length;
  }
  const cd = Buffer.concat(centrals);
  const comment = Buffer.from(opts.comment ?? '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.eocdEntries ?? entries.length, 8); eocd.writeUInt16LE(opts.eocdEntries ?? entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, cd, eocd, comment]);
}

export interface IBundleManifestPartFx { part_number: number; filename: string; row_count: number; bytes: number; sha256: string }
export interface IBundleFx {
  manifest: Record<string, any> & { parts: IBundleManifestPartFx[] };
  /** Members after manifest.json, in manifest order. */
  members: Array<{ name: string; data: Buffer }>;
}

const stamp = (iso: string) => iso.replace(/\.\d+/, '').replace(/\+00:00$|Z$/, '').replace(/[-:]/g, '') + 'Z';

/**
 * A bundle exactly as the People Pipeline's Phase 9B export produces it (same names, manifest keys, order): rows are cut into
 * contiguous parts of `partSize`, every part in the existing export format with one shared exported_at.
 */
export function makeBundle(rows: ExportRowInput[], opts: { format?: 'csv' | 'json'; partSize?: number; exportedAt?: string; bundleHex?: string } = {}): IBundleFx {
  const format = opts.format ?? 'csv';
  const partSize = opts.partSize ?? 10_000;
  const exportedAt = opts.exportedAt ?? '2026-10-01T10:00:00+00:00';
  const stampText = stamp(exportedAt);
  const hex12 = opts.bundleHex ?? randomBytes(6).toString('hex');
  const count = Math.ceil(rows.length / partSize);
  const stamped = rows.map((r) => ({ ...r, exported_at: exportedAt }));
  const members: IBundleFx['members'] = [];
  const parts: IBundleManifestPartFx[] = [];
  for (let i = 0; i < count; i++) {
    const chunk = stamped.slice(i * partSize, (i + 1) * partSize);
    const data = Buffer.from(format === 'csv' ? toCsv(chunk) : toJson(chunk), 'utf8');
    const name = `orion_published_people_${stampText}_${hex12.slice(0, 8)}_part-${String(i + 1).padStart(4, '0')}-of-${String(count).padStart(4, '0')}.${format}`;
    parts.push({ part_number: i + 1, filename: name, row_count: chunk.length, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    members.push({ name, data });
  }
  return {
    manifest: { export_version: '1', exported_at: exportedAt, bundle_id: `${stampText}-${hex12}`, format, max_part_rows: partSize, total_rows: rows.length, part_count: count, parts },
    members,
  };
}

/** Pack a (possibly tampered) bundle: manifest first, then the members in the order given. */
export function packBundle(b: IBundleFx, over: { manifestBytes?: Buffer; manifestFirst?: boolean; extra?: IZipSpec[] } = {}): Buffer {
  const manifest: IZipSpec = { name: 'manifest.json', data: over.manifestBytes ?? Buffer.from(JSON.stringify(b.manifest, null, 2) + '\n', 'utf8') };
  const members: IZipSpec[] = b.members.map((m) => ({ name: m.name, data: m.data }));
  const all = over.manifestFirst === false ? [...members, manifest] : [manifest, ...members];
  return buildZip([...all, ...(over.extra ?? [])]);
}

export const toBase64 = (zip: Buffer) => zip.toString('base64');
export { exportRow };
export type { ExportRowInput };
