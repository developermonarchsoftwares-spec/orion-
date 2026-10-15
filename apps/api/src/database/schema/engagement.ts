import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { businesses } from './businesses';
import { people } from './people';

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 150 }).notNull(),
    filters: jsonb('filters').notNull(),
    alertEnabled: boolean('alert_enabled').default(false).notNull(),
    alertFrequency: varchar('alert_frequency', { length: 50 }).default('DAILY').notNull(),
    lastAlertSentAt: timestamp('last_alert_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('saved_searches_user_idx').on(table.userId),
  ]
);

export const savedLeads = pgTable(
  'saved_leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    /** When set, this lead is a person-at-company lead rather than a plain company lead. */
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    notes: text('notes'),
    pipelineStage: varchar('pipeline_stage', { length: 50 }).default('NEW').notNull(),
    tags: jsonb('tags').default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('saved_leads_user_idx').on(table.userId),
    index('saved_leads_business_idx').on(table.businessId),
    index('saved_leads_person_idx').on(table.personId),
    uniqueIndex('saved_leads_user_business_person_uq')
      .on(table.userId, table.businessId, table.personId)
      .where(sql`${table.personId} IS NOT NULL`),
  ]
);
