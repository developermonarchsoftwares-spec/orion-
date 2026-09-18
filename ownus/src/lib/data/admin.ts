import type { ImportRecord, DuplicateGroup, AdminLog, SystemService } from '@/lib/types';

/**
 * Admin data collections in Orion.
 * In production, import batches, audit logs, duplicate merges, and service health
 * are fetched dynamically from PostgreSQL and NestJS system health indicators.
 */
export const importHistory: ImportRecord[] = [];
export const duplicateGroups: DuplicateGroup[] = [];
export const adminLogs: AdminLog[] = [];
export const systemServices: SystemService[] = [];
