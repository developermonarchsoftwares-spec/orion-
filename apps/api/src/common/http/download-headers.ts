import type { Response } from 'express';

/** Characters allowed in a download file name; everything else (quotes, slashes, control characters, non-ASCII) becomes "_". */
export function safeDownloadName(name: string | null | undefined, fallback = 'download'): string {
  const cleaned = String(name ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || fallback;
}

/**
 * Headers for a file that holds customer data: always a download (never rendered), never stored by browsers or
 * shared caches, never content-sniffed. The file name is derived here, so it cannot carry a path or header injection.
 */
export function applyDownloadHeaders(res: Response, contentType: string, fileName: string): void {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${safeDownloadName(fileName)}"`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
