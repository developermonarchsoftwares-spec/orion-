import { BadRequestException } from '@nestjs/common';

/**
 * Structural validation of an uploaded batch (manual CSV / JSON / XLSX rows already parsed by the client), run BEFORE any row is
 * stored or processed. It looks at shape and size only, never at business meaning, and it never echoes cell content back: an
 * issue names a row number and a problem code, nothing else.
 */
export const UPLOAD_LIMITS = Object.freeze({
  MAX_ROWS: 5000,
  MAX_COLUMNS_PER_ROW: 200,
  MAX_COLUMN_NAME_LENGTH: 200,
  MAX_CELL_LENGTH: 5000,
  /** Sum of all column names and cell texts of the whole batch. */
  MAX_TOTAL_CHARS: 10 * 1024 * 1024,
  MAX_REPORTED_ISSUES: 20,
});

export type UploadIssueCode =
  | 'NOT_AN_OBJECT'
  | 'TOO_MANY_COLUMNS'
  | 'COLUMN_NAME_TOO_LONG'
  | 'UNSAFE_COLUMN_NAME'
  | 'NESTED_OR_UNSUPPORTED_VALUE'
  | 'CELL_TOO_LONG'
  | 'CONTROL_CHARACTER';

export interface IUploadIssue {
  /** 1-based row number, as the uploader sees it. */
  row: number;
  problem: UploadIssueCode;
}

/** Column names that would address the object prototype instead of a field. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// every control character except tab, line feed and carriage return (addresses legitimately contain line breaks)
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function findUploadIssues(rows: unknown): { issues: IUploadIssue[]; totalChars: number } {
  const issues: IUploadIssue[] = [];
  let totalChars = 0;
  const add = (row: number, problem: UploadIssueCode) => {
    if (issues.length < UPLOAD_LIMITS.MAX_REPORTED_ISSUES) issues.push({ row, problem });
  };
  if (!Array.isArray(rows)) return { issues, totalChars };
  rows.forEach((row, i) => {
    const n = i + 1;
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      add(n, 'NOT_AN_OBJECT');
      return;
    }
    const keys = Object.keys(row);
    if (keys.length > UPLOAD_LIMITS.MAX_COLUMNS_PER_ROW) add(n, 'TOO_MANY_COLUMNS');
    for (const key of keys.slice(0, UPLOAD_LIMITS.MAX_COLUMNS_PER_ROW + 1)) {
      totalChars += key.length;
      if (key.length > UPLOAD_LIMITS.MAX_COLUMN_NAME_LENGTH) add(n, 'COLUMN_NAME_TOO_LONG');
      if (UNSAFE_KEYS.has(key.trim().toLowerCase())) add(n, 'UNSAFE_COLUMN_NAME');
      if (CONTROL.test(key)) add(n, 'CONTROL_CHARACTER');
      const value = (row as Record<string, unknown>)[key];
      if (value === null || value === undefined) continue;
      if (typeof value === 'string') {
        totalChars += value.length;
        if (value.length > UPLOAD_LIMITS.MAX_CELL_LENGTH) add(n, 'CELL_TOO_LONG');
        else if (CONTROL.test(value)) add(n, 'CONTROL_CHARACTER');
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        totalChars += 8;
      } else {
        add(n, 'NESTED_OR_UNSUPPORTED_VALUE');
      }
    }
  });
  return { issues, totalChars };
}

/** Throws a 400 listing row numbers and problem codes (never content) when the batch is not safe to store or process. */
export function assertUploadRows(rows: unknown, kind: 'preview' | 'import'): asserts rows is Array<Record<string, unknown>> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new BadRequestException(kind === 'preview' ? 'No rows provided for import preview' : 'Cannot submit empty import batch');
  }
  if (rows.length > UPLOAD_LIMITS.MAX_ROWS) {
    throw new BadRequestException(
      `Batch size exceeds maximum limit of ${UPLOAD_LIMITS.MAX_ROWS.toLocaleString('en-US')} records per upload to prevent server memory exhaustion.`,
    );
  }
  const { issues, totalChars } = findUploadIssues(rows);
  if (totalChars > UPLOAD_LIMITS.MAX_TOTAL_CHARS) {
    throw new BadRequestException({ message: 'The upload is too large; split it into smaller files', errorCode: 'UPLOAD_TOO_LARGE', statusCode: 400 });
  }
  if (issues.length > 0) {
    throw new BadRequestException({
      message: 'The upload contains rows that cannot be processed safely; nothing was imported',
      errorCode: 'UPLOAD_INVALID',
      statusCode: 400,
      details: { issues },
    });
  }
}
