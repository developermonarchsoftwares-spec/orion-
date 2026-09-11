export const QUEUE_NAMES = {
  IMPORT_PROCESSING: 'import-processing',
  DATA_ENRICHMENT: 'data-enrichment',
  TYPESENSE_SYNC: 'typesense-sync',
  DUPLICATE_DETECTION: 'duplicate-detection',
  NOTIFICATION: 'notification',
  AUDIT_LOG: 'audit-log',
} as const;

export type QueueNameType = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
