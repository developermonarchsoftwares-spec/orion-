import { pgTable, uuid, varchar, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users';

/** Every checkout order created for a customer, so a payment can only be redeemed for exactly what was ordered. */
export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: varchar('order_id', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** PACKAGE (plan purchase) or TOPUP (extra credits, no plan change). */
    kind: varchar('kind', { length: 10 }).notNull(),
    packageId: uuid('package_id'),
    credits: integer('credits').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    billingCycle: varchar('billing_cycle', { length: 10 }).default('monthly').notNull(),
    /** CREATED -> PAID. */
    status: varchar('status', { length: 16 }).default('CREATED').notNull(),
    paymentId: varchar('payment_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('payment_orders_order_id_idx').on(table.orderId),
    index('payment_orders_user_idx').on(table.userId),
  ]
);

/** One invoice per captured payment (unique payment_id), with a gap-free-in-practice sequential number. */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    invoiceNumber: varchar('invoice_number', { length: 32 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: varchar('order_id', { length: 64 }),
    paymentId: varchar('payment_id', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 10 }).notNull(),
    description: varchar('description', { length: 255 }).notNull(),
    credits: integer('credits').notNull(),
    currency: varchar('currency', { length: 3 }).default('INR').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    /** Tax rate in basis points (1800 = 18%). Prices are tax-inclusive: tax is carved out of the total. */
    taxBps: integer('tax_bps').default(0).notNull(),
    taxPaise: integer('tax_paise').default(0).notNull(),
    totalPaise: integer('total_paise').notNull(),
    /** ISSUED or REFUNDED. */
    status: varchar('status', { length: 16 }).default('ISSUED').notNull(),
    billingName: varchar('billing_name', { length: 255 }),
    billingEmail: varchar('billing_email', { length: 255 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('invoices_number_idx').on(table.invoiceNumber),
    uniqueIndex('invoices_payment_idx').on(table.paymentId),
    index('invoices_user_idx').on(table.userId),
  ]
);

/** At most one refund per payment (unique payment_id): full refunds only. */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    paymentId: varchar('payment_id', { length: 64 }).notNull(),
    invoiceId: uuid('invoice_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    amountPaise: integer('amount_paise').notNull(),
    creditsReversed: integer('credits_reversed').default(0).notNull(),
    /** Credits that could not be taken back because the customer had already spent them. */
    creditsShortfall: integer('credits_shortfall').default(0).notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    /** GATEWAY_REFUNDED (money returned through the gateway) or MANUAL_REQUIRED (money must be returned out of band). */
    status: varchar('status', { length: 24 }).notNull(),
    gatewayRefundId: varchar('gateway_refund_id', { length: 64 }),
    requestedBy: uuid('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('refunds_payment_idx').on(table.paymentId),
    index('refunds_user_idx').on(table.userId),
  ]
);

/** The user's current plan/tier. Time-boxed: a plan purchase grants its tier for one billing cycle (no auto-renewal). */
export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id'),
    tier: varchar('tier', { length: 50 }).notNull(),
    billingCycle: varchar('billing_cycle', { length: 10 }).default('monthly').notNull(),
    /** ACTIVE or CANCELLED (a refunded plan purchase). */
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    paymentId: varchar('payment_id', { length: 64 }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('user_subscriptions_user_idx').on(table.userId)]
);
