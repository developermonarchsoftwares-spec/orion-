/**
 * Race-safe bookkeeping for the administrator e-mail code (OTP), shared by the gateway handler and its tests.
 *
 * A "read the counter, compare, then write" sequence is not safe: a burst of parallel guesses all read "0 attempts used" and are all
 * evaluated, and two parallel requests with the correct code both see the row before either deletes it. Both steps are therefore a
 * single atomic statement whose result says whether this caller won:
 *  - an attempt is CLAIMED before the code is compared, and only while attempts remain, so the total number of guesses per code can
 *    never exceed `max_attempts` however the requests interleave;
 *  - the code is REDEEMED by deleting its row; only one caller can delete it, so one code can never mint two sessions.
 *
 * Any database error yields an empty result, which both functions read as "refused" (fail closed).
 */
export type OtpQuery = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;

export const CLAIM_OTP_ATTEMPT_SQL = `UPDATE admin_otps SET attempts = attempts + 1 WHERE id = $1 AND attempts < max_attempts RETURNING id`;
export const REDEEM_OTP_SQL = `DELETE FROM admin_otps WHERE id = $1 RETURNING id`;

/** True when this caller used one of the code's remaining attempts; false when the code is locked. */
export async function claimOtpAttempt(query: OtpQuery, id: string): Promise<boolean> {
  return (await query(CLAIM_OTP_ATTEMPT_SQL, [id])).length > 0;
}

/** True only for the single caller that consumed the code. */
export async function redeemOtp(query: OtpQuery, id: string): Promise<boolean> {
  return (await query(REDEEM_OTP_SQL, [id])).length > 0;
}
