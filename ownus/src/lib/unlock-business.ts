/* eslint-disable @typescript-eslint/no-explicit-any -- raw SQL rows and decoded JWT payloads are untyped by nature */
/**
 * Credit-spending helpers for the gateway's native fallback (used only when the NestJS API is unreachable).
 * The NestJS API stays the single source of truth; these keep the fallback from being weaker than it:
 *  - the caller is identified ONLY by a signature-verified token (see gateway-auth.ts), never by a request body field or default;
 *  - the unlock is ONE atomic statement: the wallet row is locked, the company must be PUBLISHED, the wallet must be funded,
 *    the unlock row is inserted once (ON CONFLICT DO NOTHING) and the single credit is deducted only if that insert happened.
 *    Concurrent requests therefore charge once, and a failed unlock never charges.
 */

/**
 * Parameters: $1 wallet id, $2 user id, $3 business id.
 * Returns one row: unlocked (1 when THIS statement unlocked and charged), funded, published, plus the new wallet figures.
 */
export const UNLOCK_BUSINESS_SQL = `
WITH w AS (
  SELECT id, daily_credits, purchased_credits FROM user_wallets WHERE id = $1 FOR UPDATE
),
funded AS (SELECT 1 FROM w WHERE daily_credits + purchased_credits >= 1),
live AS (SELECT 1 FROM businesses WHERE id = $3::uuid AND status = 'PUBLISHED'),
ins AS (
  INSERT INTO lead_unlocks (user_id, business_id, credits_spent)
  SELECT $2::uuid, $3::uuid, 1 WHERE EXISTS (SELECT 1 FROM funded) AND EXISTS (SELECT 1 FROM live)
  ON CONFLICT (user_id, business_id) DO NOTHING
  RETURNING id
),
upd AS (
  UPDATE user_wallets u SET
    daily_credits = u.daily_credits - CASE WHEN u.daily_credits > 0 THEN 1 ELSE 0 END,
    purchased_credits = u.purchased_credits - CASE WHEN u.daily_credits > 0 THEN 0 ELSE 1 END,
    balance = u.balance - 1,
    lifetime_used = u.lifetime_used + 1,
    updated_at = NOW()
  WHERE u.id = $1 AND EXISTS (SELECT 1 FROM ins)
  RETURNING u.daily_credits, u.purchased_credits, u.balance
),
led AS (
  INSERT INTO credit_transactions (wallet_id, user_id, amount, balance_after, balance_type, daily_balance_after, purchased_balance_after, type, description, reference_id)
  SELECT $1::uuid, $2::uuid, -1, upd.balance, CASE WHEN (SELECT daily_credits FROM w) > 0 THEN 'DAILY' ELSE 'PURCHASED' END,
    upd.daily_credits, upd.purchased_credits, 'UNLOCK_LEAD', 'Unlocked business contact details', $3::uuid FROM upd
  RETURNING id
)
SELECT (SELECT count(*) FROM ins)::int AS unlocked,
  (SELECT count(*) FROM funded)::int AS funded,
  (SELECT count(*) FROM live)::int AS published,
  (SELECT daily_credits FROM upd) AS daily_credits,
  (SELECT purchased_credits FROM upd) AS purchased_credits,
  (SELECT balance FROM upd) AS balance
`;

export type UnlockOutcome =
  | { kind: 'UNLOCKED'; balance: number; dailyCredits: number; purchasedCredits: number }
  | { kind: 'NOT_FOUND' }
  | { kind: 'INSUFFICIENT_CREDITS' }
  | { kind: 'ALREADY_UNLOCKED' };

/** Reads the single result row of UNLOCK_BUSINESS_SQL. `alreadyUnlocked` is looked up by the caller only when nothing was unlocked. */
export function interpretUnlockRow(row: Record<string, any> | undefined, alreadyUnlocked: boolean): UnlockOutcome {
  if (row && Number(row.unlocked) === 1) {
    return { kind: 'UNLOCKED', balance: Number(row.balance), dailyCredits: Number(row.daily_credits), purchasedCredits: Number(row.purchased_credits) };
  }
  if (!row || Number(row.published) === 0) return alreadyUnlocked ? { kind: 'ALREADY_UNLOCKED' } : { kind: 'NOT_FOUND' };
  if (Number(row.funded) === 0 && !alreadyUnlocked) return { kind: 'INSUFFICIENT_CREDITS' };
  return { kind: 'ALREADY_UNLOCKED' };
}
