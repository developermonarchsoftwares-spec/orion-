/**
 * RFC 4180 CSV parser for bulk import: quoted fields, doubled quotes, embedded commas and line breaks, CRLF/LF/CR, a UTF-8 BOM,
 * and comma / semicolon / tab delimiters (detected from the header line). It never throws on bad data: structural problems are
 * returned as issues so the uploader gets a report instead of a failed request. Issues carry row numbers and codes only, never
 * cell content.
 */
export type CsvIssueCode =
  | 'EMPTY_FILE'
  | 'EMPTY_HEADER'
  | 'DUPLICATE_HEADER'
  | 'UNTERMINATED_QUOTE'
  | 'TOO_MANY_ROWS'
  | 'TOO_MANY_COLUMNS'
  | 'MORE_CELLS_THAN_HEADERS'
  | 'FEWER_CELLS_THAN_HEADERS';

export interface ICsvIssue {
  /** 1-based line of the file's records (header = row 0; first data row = 1). 0 for file-level problems. */
  row: number;
  problem: CsvIssueCode;
  /** `true` when the file cannot be used at all. */
  fatal: boolean;
}

export interface ICsvParseResult {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: string;
  issues: ICsvIssue[];
  rowCount: number;
}

export interface ICsvParseOptions {
  maxRows?: number;
  maxColumns?: number;
}

const DELIMITERS = [',', ';', '\t'];

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    // count delimiters outside quotes
    let inQuotes = false;
    let n = 0;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** Splits CSV text into records of cells. Returns `unterminated: true` when a quote is never closed. */
function tokenize(text: string, delimiter: string): { records: string[][]; unterminated: boolean } {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  const endCell = () => {
    row.push(cell);
    cell = '';
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    records.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === delimiter) endCell();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') endRow();
    else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (cell !== '' || cellStarted || row.length > 0) endRow();
  return { records, unterminated: inQuotes };
}

export function parseCsv(input: string, opts: ICsvParseOptions = {}): ICsvParseResult {
  const maxRows = opts.maxRows ?? 5000;
  const maxColumns = opts.maxColumns ?? 200;
  const issues: ICsvIssue[] = [];
  const empty = (delimiter = ','): ICsvParseResult => ({ headers: [], rows: [], delimiter, issues, rowCount: 0 });

  const text = String(input ?? '').replace(/^﻿/, '');
  if (!text.trim()) {
    issues.push({ row: 0, problem: 'EMPTY_FILE', fatal: true });
    return empty();
  }
  const delimiter = detectDelimiter(text);
  const { records, unterminated } = tokenize(text, delimiter);
  if (unterminated) issues.push({ row: 0, problem: 'UNTERMINATED_QUOTE', fatal: true });

  // a trailing blank line is not a record
  while (records.length && records[records.length - 1].every((c) => c.trim() === '')) records.pop();
  if (!records.length) {
    issues.push({ row: 0, problem: 'EMPTY_FILE', fatal: true });
    return empty(delimiter);
  }

  const headers = records[0].map((h) => h.trim());
  if (headers.length > maxColumns) {
    issues.push({ row: 0, problem: 'TOO_MANY_COLUMNS', fatal: true });
    return { headers: [], rows: [], delimiter, issues, rowCount: 0 };
  }
  const seen = new Set<string>();
  headers.forEach((h) => {
    if (!h) issues.push({ row: 0, problem: 'EMPTY_HEADER', fatal: false });
    else if (seen.has(h.toLowerCase())) issues.push({ row: 0, problem: 'DUPLICATE_HEADER', fatal: false });
    seen.add(h.toLowerCase());
  });

  const body = records.slice(1);
  if (body.length > maxRows) issues.push({ row: 0, problem: 'TOO_MANY_ROWS', fatal: true });
  if (issues.some((i) => i.fatal)) return { headers, rows: [], delimiter, issues, rowCount: body.length };

  const rows: Array<Record<string, string>> = [];
  body.forEach((cells, idx) => {
    const n = idx + 1;
    if (cells.every((c) => c.trim() === '')) return; // blank line inside the file
    if (cells.length > headers.length) issues.push({ row: n, problem: 'MORE_CELLS_THAN_HEADERS', fatal: false });
    else if (cells.length < headers.length) issues.push({ row: n, problem: 'FEWER_CELLS_THAN_HEADERS', fatal: false });
    const obj: Record<string, string> = Object.create(null);
    headers.forEach((h, c) => {
      // an empty header has no usable name; the first of two same-named columns wins
      if (h && !(h in obj)) obj[h] = cells[c] ?? '';
    });
    rows.push({ ...obj });
  });
  return { headers, rows, delimiter, issues, rowCount: rows.length };
}
