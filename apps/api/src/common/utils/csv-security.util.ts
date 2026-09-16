/**
 * CSV / Spreadsheet Formula Injection Sanitizer
 *
 * Prevents CSV Injection (Formula Injection / CWE-1236) where user-controlled values
 * starting with characters like '=', '+', '-', '@', '\t', or '\r' can be interpreted as
 * executable spreadsheet formulas by Excel, Google Sheets, or LibreOffice Calc.
 */

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

export class CsvSecurityUtil {
  /**
   * Sanitizes an individual cell value against CSV formula injection.
   * If the string begins with a formula trigger character, it is safely prefixed with a single quote.
   */
  static sanitizeCell(val: unknown): string {
    if (val === null || val === undefined) {
      return '';
    }

    const str = String(val);
    if (str.length === 0) {
      return '';
    }

    // If string starts with a formula trigger character, prepend a single quote
    if (FORMULA_TRIGGER_CHARS.some((char) => str.startsWith(char))) {
      return `'${str}`;
    }

    return str;
  }

  /**
   * Formats a row of values into a safe, escaped CSV row string.
   */
  static formatCsvRow(values: unknown[]): string {
    return values
      .map((val) => {
        const sanitized = this.sanitizeCell(val);
        // Escape double quotes inside cell
        const escaped = sanitized.replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(',');
  }
}
