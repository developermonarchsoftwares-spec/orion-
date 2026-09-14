import type { ImportRecord, DuplicateGroup, AdminLog, SystemService } from '@/lib/types';

/**
 * Admin data collections in Orion.
 * In production, import batches, audit logs, and duplicate merges are managed via PostgreSQL and BullMQ.
 */
export const importHistory: ImportRecord[] = [];
export const duplicateGroups: DuplicateGroup[] = [];
export const adminLogs: AdminLog[] = [];
export const systemServices: SystemService[] = [
  { name: 'PostgreSQL Database', status: 'operational', uptime: '99.99%', responseTime: 12 },
  { name: 'Upstash Redis & BullMQ', status: 'operational', uptime: '99.98%', responseTime: 18 },
  { name: 'Cloudflare R2 Storage', status: 'operational', uptime: '100.0%', responseTime: 25 },
  { name: 'NestJS REST API', status: 'operational', uptime: '99.95%', responseTime: 15 },
];
