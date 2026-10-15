import { sql } from 'drizzle-orm';
import { DrizzleDb } from '../../database/database.provider';

/**
 * Expires every stored scheduled-export file (`export_jobs.content`). A stored file is a copy of contact data taken before a removal, so
 * after a company contact or a person has been suppressed, any file still held may contain it; the owner's next scheduled run produces a
 * clean one. The history row stays (marked EXPIRED). Files already downloaded by a customer cannot be recalled.
 * Shared by the company-contact register, the People suppression paths and the post-restore ledger re-apply.
 */
export async function expireStoredExports(q: Pick<DrizzleDb, 'execute'>): Promise<number> {
  const res: any = await q.execute(sql`UPDATE export_jobs SET content = NULL, status = 'EXPIRED' WHERE content IS NOT NULL AND status = 'COMPLETED'`);
  return res?.rowCount ?? 0;
}
