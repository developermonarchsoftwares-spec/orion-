import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * E-mail ownership challenges (sign-up verification).
 *
 * One row per code that was sent. Only an HMAC of the code is stored (never the code). A code is usable once: `consumed_at` is set in the same
 * statement that accepts it. A successful check also stores the hash of a one-time PROOF (`proof_hash`); registration must present that proof and
 * consumes it (`proof_consumed_at`) in the same transaction that creates the account, so a verified address cannot create two accounts or be reused.
 * The API and the web gateway both read and write this table, so the rules are identical on either path.
 */
export const emailOtpChallenges = pgTable(
  'email_otp_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Normalised (trimmed, lower-case) address the code was sent to. */
    email: varchar('email', { length: 255 }).notNull(),
    /** What the code authorises. Only 'REGISTER' exists today. */
    purpose: varchar('purpose', { length: 32 }).notNull(),
    otpHash: varchar('otp_hash', { length: 128 }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Set when the code was accepted (single use). */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /** Set when a newer code replaced this one, or another code for the address was accepted. */
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    /** Set when the attempt limit was reached. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    /** SHA-256 of the one-time proof handed out after a correct code. */
    proofHash: varchar('proof_hash', { length: 128 }),
    proofExpiresAt: timestamp('proof_expires_at', { withTimezone: true }),
    proofConsumedAt: timestamp('proof_consumed_at', { withTimezone: true }),
    /** Keyed digest of the requesting address (rate limiting only; the address itself is not stored here). */
    ipHash: varchar('ip_hash', { length: 64 }),
  },
  (table) => [
    index('idx_email_otp_email_purpose_created').on(table.email, table.purpose, table.createdAt),
    index('idx_email_otp_ip_created').on(table.ipHash, table.createdAt),
    index('idx_email_otp_expires_at').on(table.expiresAt),
  ],
);

export type EmailOtpChallenge = typeof emailOtpChallenges.$inferSelect;
export type NewEmailOtpChallenge = typeof emailOtpChallenges.$inferInsert;
