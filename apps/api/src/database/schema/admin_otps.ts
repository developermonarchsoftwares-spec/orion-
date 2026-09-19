import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const adminOtps = pgTable(
  'admin_otps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    otp: varchar('otp', { length: 255 }).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_admin_otps_email').on(table.email),
    index('idx_admin_otps_expires_at').on(table.expiresAt),
  ],
);

export type AdminOtp = typeof adminOtps.$inferSelect;
export type NewAdminOtp = typeof adminOtps.$inferInsert;
