import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'SUPER_ADMIN',
  'ADMIN',
  'DATA_MANAGER',
  'MEMBER',
  'USER',
]);

export const userStatusEnum = pgEnum('user_status', [
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'PENDING_VERIFICATION',
]);

export const businessStatusEnum = pgEnum('business_status', [
  'DRAFT',
  'PENDING_VALIDATION',
  'VERIFIED',
  'PUBLISHED',
  'ARCHIVED',
  'REJECTED',
]);

export const businessOpportunityTierEnum = pgEnum('business_opportunity_tier', [
  'HIGH',
  'MEDIUM',
  'LOW',
  'NONE',
]);

export const businessTypeEnum = pgEnum('business_type_enum', [
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'LLP',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'OPC',
  'FOREIGN_COMPANY',
  'TRUST',
  'SOCIETY',
  'OTHER',
]);

export const msmeCategoryEnum = pgEnum('msme_category_enum', [
  'MICRO',
  'SMALL',
  'MEDIUM',
  'ENTERPRISE',
  'NOT_APPLICABLE',
]);

export const identifierTypeEnum = pgEnum('identifier_type_enum', [
  'CIN',
  'GSTIN',
  'PAN',
  'UDYAM',
  'LEI',
  'TAN',
  'REG_NO',
  'OTHER',
]);

export const digitalPlatformEnum = pgEnum('digital_platform_enum', [
  'WEBSITE',
  'LINKEDIN',
  'TWITTER',
  'FACEBOOK',
  'INSTAGRAM',
  'YOUTUBE',
  'GITHUB',
  'CRUNCHBASE',
  'OTHER',
]);

export const dataSourceTypeEnum = pgEnum('data_source_type', [
  'GOVERNMENT_REGISTRY',
  'WEB_SCRAPING',
  'MANUAL_IMPORT',
  'API_INTEGRATION',
  'USER_SUBMISSION',
  'PARTNER_FEED',
]);

export const importStatusEnum = pgEnum('import_status', [
  'PENDING',
  'PARSING',
  'PROCESSING',
  'ENRICHING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const importRecordStatusEnum = pgEnum('import_record_status_enum', [
  'PENDING',
  'NORMALIZED',
  'VALIDATED',
  'FLAGGED_DUPLICATE',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'MERGED',
  'PUBLISHED',
  'FAILED',
]);

export const validationSeverityEnum = pgEnum('validation_severity_enum', [
  'ERROR',
  'WARNING',
  'INFO',
]);

export const duplicateMatchTypeEnum = pgEnum('duplicate_match_type_enum', [
  'EXACT',
  'IDENTIFIER',
  'FUZZY_NAME',
  'LOCATION',
]);

export const reviewActionEnum = pgEnum('review_action_enum', [
  'APPROVE',
  'REJECT',
  'MERGE',
  'EDIT',
  'PUBLISH',
]);

export const searchSyncStatusEnum = pgEnum('search_sync_status_enum', [
  'PENDING',
  'SYNCED',
  'FAILED',
  'RETRYING',
]);

export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', [
  'PURCHASE',
  'UNLOCK_LEAD',
  'EXPORT_DATA',
  'REFUND',
  'ADMIN_ADJUSTMENT',
  'BONUS',
  'DAILY_ALLOCATION',
  'DAILY_EXPIRATION',
  'PACKAGE_PURCHASE',
  'SUBSCRIPTION',
]);

export const packageBillingTypeEnum = pgEnum('package_billing_type', [
  'ONE_TIME',
  'SUBSCRIPTION',
  'DAILY_FREE',
  'CUSTOM',
]);

export const storageProviderTypeEnum = pgEnum('storage_provider_type', [
  's3',
  'r2',
  'minio',
  'local',
]);
