import { inflateRawSync } from 'zlib';

/**
 * A deliberately small, defensive ZIP reader for UNTRUSTED uploads (Phase 9D). It reads the central directory (so duplicate entries,
 * entry order and declared sizes are all visible, which a convenience library hides), never touches the file system and never
 * executes anything: entries are returned as in-memory buffers.
 *
 * Accepted: a single-disk, non-ZIP64, unencrypted archive whose entries are stored or deflated, with flat, plain file names.
 * Everything else is refused with a machine code (never any entry content). Limits are checked on the DECLARED sizes before any
 * data is inflated, and again while inflating (`maxOutputLength`), so an archive that lies about its sizes cannot expand beyond them.
 */
export interface ISafeZipLimits {
  maxZipBytes: number;
  maxEntries: number;
  /** Largest allowed uncompressed size of one entry, by name. */
  maxEntryBytes: (name: string) => number;
  /** Largest allowed sum of all uncompressed entry sizes. */
  maxTotalBytes: number;
}

export interface IZipEntry {
  name: string;
  data: Buffer;
}

export type ZipErrorCode =
  | 'ZIP_MALFORMED'
  | 'ZIP_UNSUPPORTED'
  | 'ZIP_UNSAFE_PATH'
  | 'ZIP_DUPLICATE_ENTRY'
  | 'ZIP_TOO_MANY_ENTRIES'
  | 'ZIP_TOO_LARGE'
  | 'ZIP_CORRUPT';

export class ZipFormatError extends Error {
  constructor(readonly code: ZipErrorCode, message: string) {
    super(message);
  }
}

const fail = (code: ZipErrorCode, message: string): never => {
  throw new ZipFormatError(code, message);
};

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
const EOCD_MIN = 22;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/;

let crcTable: Uint32Array | null = null;
export function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checkName(name: string): void {
  // traversal, absolute, drive-letter, backslash, NUL and control characters are all "unsafe path"; so is anything not a plain flat name
  if (
    !name ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name) ||
    name.includes('\\') ||
    name.includes('\0') ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    name.split('/').some((seg) => seg === '..' || seg === '.') ||
    name.includes('/') ||
    !SAFE_NAME.test(name)
  ) {
    fail('ZIP_UNSAFE_PATH', 'The archive contains an entry with an unsafe name');
  }
}

export function readZip(buf: Buffer, limits: ISafeZipLimits): IZipEntry[] {
  if (!Buffer.isBuffer(buf) || buf.length < EOCD_MIN) fail('ZIP_MALFORMED', 'The file is not a ZIP archive');
  if (buf.length > limits.maxZipBytes) fail('ZIP_TOO_LARGE', 'The archive is larger than the allowed size');

  // end of central directory record: the last signature whose comment length reaches exactly the end of the file
  let eocd = -1;
  for (let p = buf.length - EOCD_MIN; p >= Math.max(0, buf.length - EOCD_MIN - 0xffff); p--) {
    if (buf.readUInt32LE(p) === EOCD_SIG && p + EOCD_MIN + buf.readUInt16LE(p + 20) === buf.length) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) return fail('ZIP_MALFORMED', 'The file is not a ZIP archive');
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIG) return fail('ZIP_UNSUPPORTED', 'ZIP64 archives are not supported');

  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const entriesOnDisk = buf.readUInt16LE(eocd + 8);
  const entriesTotal = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesOnDisk !== entriesTotal) fail('ZIP_UNSUPPORTED', 'Multi-part archives are not supported');
  if (entriesTotal === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail('ZIP_UNSUPPORTED', 'ZIP64 archives are not supported');
  if (entriesTotal > limits.maxEntries) fail('ZIP_TOO_MANY_ENTRIES', 'The archive has too many entries');
  if (cdOffset + cdSize > eocd) fail('ZIP_MALFORMED', 'The archive directory is damaged');

  const seen = new Set<string>();
  const seenFolded = new Set<string>();
  const meta: Array<{ name: string; method: number; crc: number; csize: number; usize: number; localOffset: number }> = [];
  let p = cdOffset;
  let declaredTotal = 0;
  for (let i = 0; i < entriesTotal; i++) {
    if (p + 46 > cdOffset + cdSize || buf.readUInt32LE(p) !== CEN_SIG) fail('ZIP_MALFORMED', 'The archive directory is damaged');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34);
    const localOffset = buf.readUInt32LE(p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > cdOffset + cdSize) fail('ZIP_MALFORMED', 'The archive directory is damaged');
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p = end;

    checkName(name);
    if (seen.has(name) || seenFolded.has(name.toLowerCase())) fail('ZIP_DUPLICATE_ENTRY', 'The archive contains the same entry twice');
    seen.add(name);
    seenFolded.add(name.toLowerCase());
    if (flags & 0x1 || flags & 0x40) fail('ZIP_UNSUPPORTED', 'Encrypted archives are not supported');
    if (method !== 0 && method !== 8) fail('ZIP_UNSUPPORTED', 'The archive uses an unsupported compression method');
    if (diskStart !== 0) fail('ZIP_UNSUPPORTED', 'Multi-part archives are not supported');
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) fail('ZIP_UNSUPPORTED', 'ZIP64 archives are not supported');
    if (usize > limits.maxEntryBytes(name)) fail('ZIP_TOO_LARGE', 'An entry is larger than the allowed size');
    declaredTotal += usize;
    if (declaredTotal > limits.maxTotalBytes) fail('ZIP_TOO_LARGE', 'The archive expands beyond the allowed size');
    if (method === 0 && csize !== usize) fail('ZIP_CORRUPT', 'The archive is damaged');
    meta.push({ name, method, crc, csize, usize, localOffset });
  }
  if (p !== cdOffset + cdSize) fail('ZIP_MALFORMED', 'The archive directory is damaged');

  const out: IZipEntry[] = [];
  for (const m of meta) {
    if (m.localOffset + 30 > cdOffset || buf.readUInt32LE(m.localOffset) !== LOC_SIG) fail('ZIP_MALFORMED', 'The archive is damaged');
    const nameLen = buf.readUInt16LE(m.localOffset + 26);
    const extraLen = buf.readUInt16LE(m.localOffset + 28);
    const nameStart = m.localOffset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + m.csize;
    if (dataEnd > cdOffset || buf.toString('utf8', nameStart, nameStart + nameLen) !== m.name) fail('ZIP_MALFORMED', 'The archive is damaged');
    const raw = buf.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (m.method === 0) {
      data = Buffer.from(raw);
    } else {
      try {
        // never produce more than one byte over the declared size: a lying header cannot make this expand further
        data = inflateRawSync(raw, { maxOutputLength: m.usize + 1 });
      } catch {
        return fail('ZIP_CORRUPT', 'The archive is damaged');
      }
    }
    if (data.length !== m.usize || crc32(data) !== m.crc) fail('ZIP_CORRUPT', 'The archive is damaged');
    out.push({ name: m.name, data });
  }
  return out;
}
