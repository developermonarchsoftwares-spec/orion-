/**
 * S-18: CSV formula-injection neutralisation for gateway-produced exports.
 *
 * Business data originates from imports and external sources. A cell whose value begins with =, +, -, @,
 * or a leading tab/CR executes as a formula when the exported file is opened in Excel, Google Sheets or
 * LibreOffice Calc. This mirrors apps/api .../common/utils/csv-security.util.ts so gateway and NestJS
 * exports behave identically.
 *
 * P9: a trigger hidden behind leading whitespace or control characters is neutralised too, because
 * spreadsheets skip that prefix before reading the cell.
 */
const TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Characters a spreadsheet skips before reading a cell: controls, spaces, DEL, no-break/zero-width/line separators, BOM. */
function isIgnorableLead(code: number): boolean {
  return code <= 0x20 || code === 0x7f || code === 0xa0 || (code >= 0x200b && code <= 0x200f) || code === 0x2028 || code === 0x2029 || code === 0xfeff;
}

/** Neutralises a single cell value by prefixing a single quote when it starts (after any ignorable lead) with a formula trigger. */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  let i = 0;
  while (i < str.length && isIgnorableLead(str.charCodeAt(i))) {
    // a tab or carriage return is itself a trigger
    if (TRIGGERS.has(str[i])) return `'${str}`;
    i++;
  }
  if (i < str.length && TRIGGERS.has(str[i])) return `'${str}`;
  return str;
}

/** Sanitises then CSV-quotes a cell (doubles embedded quotes, wraps in quotes). */
export function csvField(value: unknown): string {
  return `"${sanitizeCsvCell(value).replace(/"/g, '""')}"`;
}
