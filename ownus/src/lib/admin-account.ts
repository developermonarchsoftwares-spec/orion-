import { queryDb } from '@/lib/db';
import { toAdminAccount, type IAdminAccount } from '@/lib/admin-role';

export { fixedOtpAllowed, toAdminAccount } from '@/lib/admin-role';
export type { IAdminAccount } from '@/lib/admin-role';

/** The persisted admin account for an email or a user id. Null on any failure: authorization fails closed. */
export async function findAdminAccount(by: { email: string } | { id: string }): Promise<IAdminAccount | null> {
  try {
    const rows = 'email' in by
      ? await queryDb(`SELECT id, email, role, status, first_name, last_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [by.email])
      : await queryDb(`SELECT id, email, role, status, first_name, last_name FROM users WHERE id = $1 LIMIT 1`, [by.id]);
    return toAdminAccount(rows?.[0]);
  } catch {
    return null;
  }
}

