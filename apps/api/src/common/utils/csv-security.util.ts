/**
 * CSV / Spreadsheet Formula Injection Sanitizer
 *
 * Prevents CSV Injection (Formula Injection / CWE-1236) where user-controlled values
 * starting with characters like '=', '+', '-', '@', '\t', or '\r' can be interpreted as
 * executable spreadsheet formulas by Excel, Google Sheets, or LibreOffice Calc.
 *
 * A trigger hidden behind leading whitespace or control characters (" =1+1", "\u0000=1+1") is treated the same,
 * because spreadsheets skip that prefix before reading the cell.
 */

const FORMULA_TRIGGER = /^[\s\u0000-\u001f\u007f\u00a0\u200b-\u200f\u2028\u2029\ufeff]*[=+\-@\t\r]/;
/** A phone number as typed by people: optional +, digits, spaces, dots, dashes, brackets. Contains no operator a spreadsheet can run. */
const PLAIN_PHONE = /^\+?[0-9][0-9 ().-]{4,24}$/;

export class CsvSecurityUtil {
  /**
   * Sanitizes an individual cell value against CSV formula injection.
   * If the string begins (after any whitespace or control characters) with a formula trigger character, it is prefixed with a single quote.
   */
  static sanitizeCell(val: unknown): string {
    if (val === null || val === undefined) {
      return '';
    }

    const str = String(val);
    if (str.length === 0) {
      return '';
    }

    if (FORMULA_TRIGGER.test(str)) {
      return `'${str}`;
    }

    return str;
  }

  /**
   * A phone-number cell: a plain international number such as "+91 98765 43210" is kept exactly as stored (a leading
   * apostrophe would corrupt it); anything else, including a "+" followed by letters or operators, is sanitized as usual.
   */
  static sanitizePhoneCell(val: unknown): string {
    const str = val === null || val === undefined ? '' : String(val);
    return PLAIN_PHONE.test(str) ? str : this.sanitizeCell(str);
  }

  /**
   * Formats a row of values into a safe, escaped CSV row string.
   * `phoneColumns` lists column indexes that hold phone numbers (see sanitizePhoneCell).
   */
  static formatCsvRow(values: unknown[], phoneColumns: readonly number[] = []): string {
    return values
      .map((val, i) => {
        const sanitized = phoneColumns.includes(i) ? this.sanitizePhoneCell(val) : this.sanitizeCell(val);
        // Escape double quotes inside cell
        const escaped = sanitized.replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(',');
  }
}
