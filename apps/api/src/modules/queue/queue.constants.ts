export const QUEUE_NAMES = {
  IMPORT_PROCESSING: 'import-processing',
  DATA_ENRICHMENT: 'data-enrichment',
  TYPESENSE_SYNC: 'typesense-sync',
  DUPLICATE_DETECTION: 'duplicate-detection',
  NOTIFICATION: 'notification',
  AUDIT_LOG: 'audit-log',
  PEOPLE_ACQUISITION: 'people-acquisition',
  PEOPLE_IMPORT: 'people-import',
} as const;

export type QueueNameType = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
