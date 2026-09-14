import type { Lead } from '@/lib/types';

/**
 * Saved leads in Orion.
 * In production, saved leads are fetched from and persisted in PostgreSQL via /api/v1/leads.
 */
export const leads: Lead[] = [];
