import { Inject, Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { eq, sql, inArray, and } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { NormalizationService, INormalizedRecordResult } from './normalization.service';
import { ValidationService } from './validation.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { PublishingService } from './publishing.service';
import { ImportPipelineService } from './import-pipeline.service';
import { ImportBatchRepository, ImportRecordRepository } from '../repositories/import.repositories';
import { PublishQueueRepository } from '../repositories/duplicate-review.repositories';
import { BusinessException } from '../../../common/errors/business.exception';
import { CsvSecurityUtil } from '../../../common/utils/csv-security.util';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { PEOPLE_TEMPLATE_COLUMNS } from '../people/import-people.types';
import { assertUploadRows } from './upload-validation';
import { assessBatchIntegrity } from './batch-integrity';

export interface IAdminImportPreviewRecord {
  rowNumber: number;
  status: 'VALID' | 'INVALID' | 'DUPLICATE' | 'WARNING';
  businessName: string;
  city: string;
  state: string;
  gstin?: string;
  phone?: string;
  email?: string;
  issues: string[];
  matchedBusinessId?: string;
  raw: Record<string, unknown>;
  normalized?: INormalizedRecordResult;
}

export interface IAdminImportPreviewResult {
  total: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  warningCount: number;
  previewRecords: IAdminImportPreviewRecord[];
  duplicates: Array<{ rowNumber: number; reason: string; matchedBusinessId?: string }>;
  errors: Array<{ rowNumber: number; field: string; message: string }>;
}

@Injectable()
export class AdminImportService {
  private readonly logger = new Logger(AdminImportService.name);

  // Canonical header dictionary for flexible CSV column mapping
  private readonly headerDictionary: Record<string, string[]> = {
    name: ['business_name', 'business name', 'businessname', 'company_name', 'company name', 'companyname', 'name', 'company', 'entity', 'entity_name', 'entity name', 'trade_name', 'trade name', 'firm_name', 'firm name', 'organization', 'organization_name', 'organization name'],
    legalName: ['legal_name', 'legal name', 'legalname', 'registered_name', 'registered name', 'registeredname', 'official_name', 'official name'],
    gstin: ['gstin', 'gst_number', 'gst number', 'gstnumber', 'gst', 'gstin_number', 'gstin number', 'gst_no', 'gst no', 'gstno'],
    cin: ['cin', 'cin_number', 'cin number', 'cinnumber', 'cin_no', 'cin no', 'corporate_id', 'corporate id', 'corporateid', 'mca_cin', 'mca cin'],
    pan: ['pan', 'pan_number', 'pan number', 'pannumber', 'pan_no', 'pan no', 'permanent_account_number'],
    address: ['address', 'address_line1', 'address line 1', 'addressline1', 'street', 'street_address', 'registered_office', 'registered office', 'premises', 'location'],
    addressLine2: ['address_line2', 'address line 2', 'addressline2'],
    city: ['city', 'city_name', 'city name', 'cityname', 'town', 'location_city', 'location city', 'hub'],
    district: ['district', 'district_name', 'district name'],
    state: ['state', 'state_name', 'state name', 'statename', 'state / ut', 'state/ut', 'province', 'region'],
    pincode: ['pincode', 'pin_code', 'pin code', 'pin', 'postal_code', 'postal code', 'postalcode', 'zip_code', 'zip code', 'zip'],
    phone: ['phone', 'phone_number', 'phone number', 'phonenumber', 'mobile', 'mobile_number', 'mobile number', 'mobilenumber', 'contact', 'contact_number', 'contact number', 'contactno', 'telephone', 'tel'],
    email: ['email', 'e-mail', 'contact_email', 'contact email', 'email_address', 'email address', 'mail'],
    website: ['website', 'website_url', 'website url', 'url', 'web', 'site', 'domain'],
    contactPerson: ['contact_person', 'contact person', 'contactperson', 'director_name', 'director name', 'director', 'promoter', 'owner', 'contact_name', 'contact name'],
    title: ['title', 'designation', 'contact_title', 'contact title', 'role'],
    businessType: ['business_type', 'business type', 'businesstype', 'entity_type', 'entity type', 'constitution', 'company_type', 'company type'],
    msmeCategory: ['msme_category', 'msme category', 'msmecategory', 'msme_classification', 'msme classification', 'enterprise_type', 'enterprise type', 'msme'],
    description: ['description', 'about', 'overview', 'summary', 'details'],
    foundingYear: ['founding_year', 'founding year', 'foundingyear', 'year_of_incorporation', 'incorporation_year', 'registration_date', 'registration date', 'established', 'year'],
    industry: ['industry', 'sector', 'industry_name', 'industry name', 'primary_industry'],
    category: ['category', 'sub_industry', 'sub industry', 'subindustry', 'sub_sector', 'segment', 'vertical'],
  };

  constructor(
    @Inject(DRIZZLE_DATABASE)
    private readonly db: DrizzleDb,
    private readonly normalizationService: NormalizationService,
    private readonly validationService: ValidationService,
    private readonly duplicateService: DuplicateDetectionService,
    private readonly publishingService: PublishingService,
    private readonly pipelineService: ImportPipelineService,
    private readonly batchRepo: ImportBatchRepository,
    private readonly recordRepo: ImportRecordRepository,
    private readonly publishQueueRepo: PublishQueueRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Generates the canonical CSV template string with required vs optional indicators
   */
  getCanonicalTemplateCsv(): string {
    const headers = [
      'business_name',
      'legal_name',
      'gstin',
      'cin',
      'pan',
      'address_line1',
      'city',
      'district',
      'state',
      'pincode',
      'phone',
      'email',
      'website',
      'contact_person',
      'contact_title',
      'business_type',
      'msme_category',
      'industry',
      'category',
      'description',
      'founding_year',
      // People (decision makers). Person 1 = contact_person + contact_title above, plus these:
      ...PEOPLE_TEMPLATE_COLUMNS,
    ];
    // The sample rows are real companies with their publicly known principal only; person-level
    // contact columns are left blank on purpose (nothing is invented for real people).
    const noPeopleColumns = PEOPLE_TEMPLATE_COLUMNS.map(() => '');

    const sampleRow1 = [
      'Tata Consultancy Services',
      'Tata Consultancy Services Limited',
      '27AAACT2727Q1ZW',
      'L22210MH1995PLC084781',
      'AAACT2727Q',
      '9th Floor Nirmal Building Nariman Point',
      'Mumbai',
      'Mumbai',
      'Maharashtra',
      '400021',
      '+91 22 67789999',
      'corporate.office@tcs.com',
      'https://www.tcs.com',
      'K. Krithivasan',
      'CEO & Managing Director',
      'PUBLIC_LIMITED',
      'NOT_APPLICABLE',
      'Information Technology',
      'IT Services & Consulting',
      'Global leader in IT services, digital and business solutions.',
      '1968',
    ];

    const sampleRow2 = [
      'Infosys Limited',
      'Infosys Limited',
      '29AAACI4397H1Z5',
      'L85110KA1981PLC013115',
      'AAACI4397H',
      'Plot No 44 Electronics City Hosur Road',
      'Bangalore',
      'Bengaluru Urban',
      'Karnataka',
      '560100',
      '+91 80 28520261',
      'investors@infosys.com',
      'https://www.infosys.com',
      'Salil Parekh',
      'CEO & Managing Director',
      'PUBLIC_LIMITED',
      'NOT_APPLICABLE',
      'Information Technology',
      'Enterprise Software & AI',
      'Next-generation digital services and consulting.',
      '1981',
    ];

    return `${headers.join(',')}\n${CsvSecurityUtil.formatCsvRow([...sampleRow1, ...noPeopleColumns])}\n${CsvSecurityUtil.formatCsvRow([...sampleRow2, ...noPeopleColumns])}\n`;
  }

  /**
   * Automatically maps incoming row keys using canonical header dictionary + custom mapping
   */
  mapRowHeaders(
    row: Record<string, unknown>,
    customMapping?: Record<string, string>,
  ): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined || value === '') continue;
      const valStr = String(value).trim();
      const cleanKey = key.toLowerCase().trim().replace(/[^a-z0-9]/g, '');

      let matchedCanonical: string | null = null;

      if (customMapping && Object.keys(customMapping).length > 0) {
        for (const [csvH, canon] of Object.entries(customMapping)) {
          const csvClean = csvH.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
          const canonClean = (canon || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

          if (csvClean === cleanKey && canon) {
            matchedCanonical = canon;
            break;
          }
          if (canonClean === cleanKey && csvH) {
            matchedCanonical = csvH;
            break;
          }
        }
      }

      if (!matchedCanonical) {
        for (const [canonicalKey, variants] of Object.entries(this.headerDictionary)) {
          if (variants.some((v) => v.toLowerCase().trim().replace(/[^a-z0-9]/g, '') === cleanKey)) {
            matchedCanonical = canonicalKey;
            break;
          }
        }
      }

      const targetKey = matchedCanonical || key;
      mapped[targetKey] = valStr;

      // Set aliases for uniform property access
      if (targetKey === 'business_name' || targetKey === 'name') {
        mapped.business_name = valStr;
        mapped.name = valStr;
        mapped.businessName = valStr;
      } else if (targetKey === 'legal_name' || targetKey === 'legalName') {
        mapped.legal_name = valStr;
        mapped.legalName = valStr;
      } else if (targetKey === 'address_line1' || targetKey === 'address') {
        mapped.address_line1 = valStr;
        mapped.address = valStr;
        mapped.addressLine1 = valStr;
      } else if (targetKey === 'contact_person' || targetKey === 'contactPerson') {
        mapped.contact_person = valStr;
        mapped.contactPerson = valStr;
      } else if (targetKey === 'contact_title' || targetKey === 'title') {
        mapped.contact_title = valStr;
        mapped.title = valStr;
      } else if (targetKey === 'business_type' || targetKey === 'businessType') {
        mapped.business_type = valStr;
        mapped.businessType = valStr;
      } else if (targetKey === 'msme_category' || targetKey === 'msmeCategory') {
        mapped.msme_category = valStr;
        mapped.msmeCategory = valStr;
      } else if (targetKey === 'founding_year' || targetKey === 'foundingYear') {
        mapped.founding_year = valStr;
        mapped.foundingYear = valStr;
      } else if (targetKey === 'category' || targetKey === 'subIndustry') {
        mapped.category = valStr;
        mapped.subIndustry = valStr;
      }
    }

    return mapped;
  }

  /**
   * Previews an uploaded dataset without writing to the database:
   * Normalizes, validates, and runs duplicate checks across both the uploaded file and existing PostgreSQL records.
   */
  async previewRows(
    rows: Array<Record<string, unknown>>,
    customMapping?: Record<string, string>,
  ): Promise<IAdminImportPreviewResult> {
    assertUploadRows(rows, 'preview'); // shape and size first: nothing below runs on an unsafe batch

    const previewRecords: IAdminImportPreviewRecord[] = [];
    const duplicates: Array<{ rowNumber: number; reason: string; matchedBusinessId?: string }> = [];
    const errors: Array<{ rowNumber: number; field: string; message: string }> = [];

    // Track intra-file seen keys to detect duplicates within the uploaded file itself
    const seenGstins = new Map<string, number>();
    const seenCins = new Map<string, number>();
    const seenNameCity = new Map<string, number>();

    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let warningCount = 0;

    for (let idx = 0; idx < rows.length; idx++) {
      const rowNumber = idx + 1;
      const rawRow = rows[idx];
      const mappedRow = this.mapRowHeaders(rawRow, customMapping);

      // 1. Normalization
      const normalized = this.normalizationService.normalizeRecord(mappedRow);
      const businessName = normalized.name || String(mappedRow.name || mappedRow.businessName || 'Unnamed');
      const primaryLoc = normalized.locations[0];
      const city = primaryLoc?.city || 'Unknown';
      const state = primaryLoc?.state || 'Unknown';

      const issues: string[] = [];

      // 2. Intra-file duplicate check
      let isIntraDuplicate = false;
      const gstinIdent = normalized.identifiers.find((i) => i.type === 'GSTIN');
      const cinIdent = normalized.identifiers.find((i) => i.type === 'CIN');

      if (gstinIdent && seenGstins.has(gstinIdent.normalizedValue)) {
        isIntraDuplicate = true;
        const prevRow = seenGstins.get(gstinIdent.normalizedValue)!;
        const reason = `Duplicate GSTIN '${gstinIdent.value}' matches row #${prevRow} in this file`;
        issues.push(reason);
        duplicates.push({ rowNumber, reason });
      } else if (gstinIdent) {
        seenGstins.set(gstinIdent.normalizedValue, rowNumber);
      }

      if (cinIdent && seenCins.has(cinIdent.normalizedValue)) {
        isIntraDuplicate = true;
        const prevRow = seenCins.get(cinIdent.normalizedValue)!;
        const reason = `Duplicate CIN '${cinIdent.value}' matches row #${prevRow} in this file`;
        issues.push(reason);
        if (!duplicates.some((d) => d.rowNumber === rowNumber)) {
          duplicates.push({ rowNumber, reason });
        }
      } else if (cinIdent) {
        seenCins.set(cinIdent.normalizedValue, rowNumber);
      }

      const nameCityKey = `${businessName.toLowerCase()}|${city.toLowerCase()}|${state.toLowerCase()}`;
      if (seenNameCity.has(nameCityKey)) {
        isIntraDuplicate = true;
        const prevRow = seenNameCity.get(nameCityKey)!;
        const reason = `Duplicate company name & location matches row #${prevRow} in this file`;
        issues.push(reason);
        if (!duplicates.some((d) => d.rowNumber === rowNumber)) {
          duplicates.push({ rowNumber, reason });
        }
      } else {
        seenNameCity.set(nameCityKey, rowNumber);
      }

      // 3. Validation
      const validation = this.validationService.validateRecord(normalized);
      validation.logs.forEach((log) => {
        if (!log.passed) {
          issues.push(`${log.severity}: ${log.message}`);
          if (log.severity === 'ERROR') {
            errors.push({ rowNumber, field: log.field, message: log.message });
          }
        }
      });

      // 4. PostgreSQL duplicate scan
      let dbDuplicateMatchId: string | undefined = undefined;
      if (validation.isValid && !isIntraDuplicate) {
        const dbMatches = await this.duplicateService.detectDuplicates(normalized);
        if (dbMatches.length > 0) {
          dbDuplicateMatchId = dbMatches[0].matchedBusinessId;
          const matchReason = `Matches existing database business (Confidence: ${dbMatches[0].confidenceScore}%, Type: ${dbMatches[0].matchType})`;
          issues.push(matchReason);
          duplicates.push({ rowNumber, reason: matchReason, matchedBusinessId: dbDuplicateMatchId });
        }
      }

      // Determine Row Status
      let status: IAdminImportPreviewRecord['status'] = 'VALID';
      if (!validation.isValid) {
        status = 'INVALID';
        invalidCount++;
      } else if (isIntraDuplicate || dbDuplicateMatchId) {
        status = 'DUPLICATE';
        duplicateCount++;
      } else if (validation.hasWarnings) {
        status = 'WARNING';
        warningCount++;
        validCount++;
      } else {
        status = 'VALID';
        validCount++;
      }

      previewRecords.push({
        rowNumber,
        status,
        businessName,
        city,
        state,
        gstin: gstinIdent?.value,
        phone: normalized.contacts[0]?.phone,
        email: normalized.contacts[0]?.email,
        issues,
        matchedBusinessId: dbDuplicateMatchId,
        raw: rawRow,
        normalized,
      });
    }

    return {
      total: rows.length,
      validCount,
      invalidCount,
      duplicateCount,
      warningCount,
      previewRecords,
      duplicates,
      errors,
    };
  }

  /**
   * Atomically commits an import batch to the database and processes records
   */
  async submitBatch(params: {
    filename: string;
    rows: Array<Record<string, unknown>>;
    createdById?: string;
    mapping?: Record<string, string>;
    /** Honoured only when the batch's source is approved. Default false: records wait for an administrator to publish them. */
    autoPublish?: boolean;
    /** The registered data source of this file. Absent = unknown provenance (stated as such, never guessed). */
    sourceId?: string;
  }) {
    assertUploadRows(params.rows, 'import');
    if (params.sourceId !== undefined) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(params.sourceId))) throw new BadRequestException('sourceId must be the id of a registered data source');
      const found = await this.db.select({ id: schema.dataSources.id }).from(schema.dataSources).where(eq(schema.dataSources.id, params.sourceId)).limit(1);
      if (!found.length) throw new BadRequestException('That data source is not registered');
    } // shape and size first: nothing is stored or processed from an unsafe batch

    // Sanitize filename against directory traversal attacks
    const sanitizedFilename = (params.filename || 'import_batch.csv')
      .replace(/[\/\\]/g, '_')
      .replace(/\.\.+/g, '.')
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    // 1. Create Import Batch record
    const batch = await this.batchRepo.create({
      filename: sanitizedFilename,
      fileKey: `imports/${Date.now()}-${sanitizedFilename}`,
      fileSize: JSON.stringify(params.rows).length,
      mimeType: sanitizedFilename.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
      status: 'PROCESSING',
      totalRecords: params.rows.length,
      createdById: params.createdById,
      sourceId: params.sourceId,
      mappingConfig: params.mapping || {},
      options: { autoPublish: params.autoPublish === true },
      startedAt: new Date(),
    });

    await this.auditLogService?.record({
      userId: params.createdById,
      action: 'IMPORT_BATCH_SUBMITTED',
      entityType: 'IMPORT_BATCH',
      entityId: batch.id,
      newValues: { filename: sanitizedFilename, totalRecords: params.rows.length, sourceId: params.sourceId ?? null, autoPublishRequested: params.autoPublish === true },
    });

    // 2. Insert records in chunks
    const chunkSize = 100;
    for (let i = 0; i < params.rows.length; i += chunkSize) {
      const chunk = params.rows.slice(i, i + chunkSize);
      await this.recordRepo.createMany(
        chunk.map((raw, idx) => {
          const rowNumber = i + idx + 1;
          const mapped = this.mapRowHeaders(raw, params.mapping);
          return {
            batchId: batch.id,
            rowNumber,
            status: 'PENDING',
            rawPayload: mapped,
          };
        }),
      );
    }

    // 3. Process records through pipeline
    const processResult = await this.pipelineService.processBatch(batch.id);

    // 4. Integrity: what the batch reports must match what is stored. A mismatch is logged and recorded on the batch, never silent.
    const totals = await this.batchRepo.recordTotals(batch.id);
    const integrity = assessBatchIntegrity({
      totalRows: params.rows.length,
      recordCount: totals.total,
      successful: processResult.successful,
      queued: processResult.queued,
      duplicates: processResult.duplicates,
      failed: processResult.failed,
      businessesPublished: totals.published,
      peopleSummary: processResult.people,
    });
    if (!integrity.ok) {
      const message = `Integrity check failed: ${integrity.issues.join('; ')}`;
      this.logger.error(`Batch ${batch.id} (${sanitizedFilename}): ${message}`);
      await this.batchRepo.updateStats(batch.id, { errorMessage: message });
    }

    return {
      batchId: batch.id,
      filename: batch.filename,
      status: 'COMPLETED',
      totalRecords: params.rows.length,
      publishedCount: processResult.successful,
      /** Clean rows waiting in the publish queue for an administrator (publish-batch). */
      awaitingPublishCount: processResult.queued,
      duplicateCount: processResult.duplicates,
      failedCount: processResult.failed,
      people: processResult.people,
      integrity,
    };
  }

  /**
   * Publishes the approved records of one batch. This is THE explicit administrator publication step (Phase 15): it needs an administrator,
   * checks the source of the batch, re-validates every record and records the outcome. A batch whose source is not approved is refused
   * unless the administrator passes allowUnreviewedSource, which is audited as an override; a revoked source is always refused.
   */
  async publishBatch(batchId: string, actor: { id: string; ip?: string | null; userAgent?: string | null }, opts: { allowUnreviewedSource?: boolean } = {}) {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new NotFoundException(`Import batch '${batchId}' not found`);
    }

    const records = await this.recordRepo.findByBatchId(batch.id, 1000);
    let newlyPublished = 0;
    let failed = 0;
    let skipped = 0;
    let refused = 0;
    const refusalCodes: Record<string, number> = {};

    for (const rec of records) {
      // Only APPROVED (or reviewer-MERGED) records have a publish-queue item (created after duplicate checks). NORMALIZED
      // records never went through duplicate detection, so they are not published from here.
      if (rec.status !== 'APPROVED' && rec.status !== 'MERGED') {
        skipped++;
        continue;
      }
      // publishRecord takes the PUBLISH QUEUE id, not the import record id.
      const queued = await this.publishQueueRepo.findLatestByRecordId(rec.id);
      if (!queued || (queued.status !== 'PENDING' && queued.status !== 'FAILED')) {
        skipped++;
        continue;
      }
      try {
        await this.publishingService.publishRecord(queued.id, { via: 'ADMIN', actorId: actor.id, allowUnreviewedSource: opts.allowUnreviewedSource === true, ip: actor.ip, userAgent: actor.userAgent });
        newlyPublished++;
      } catch (err: any) {
        if (err instanceof BusinessException) {
          refused++;
          refusalCodes[err.errorCode] = (refusalCodes[err.errorCode] ?? 0) + 1;
        } else failed++;
        this.logger.warn(`Failed to publish record ${rec.id}: ${err.message}`);
      }
    }

    await this.batchRepo.updateStats(batch.id, { status: 'COMPLETED', completedAt: new Date() });

    await this.auditLogService?.record({
      userId: actor.id,
      action: 'IMPORT_BATCH_PUBLISH_RUN',
      entityType: 'IMPORT_BATCH',
      entityId: batch.id,
      outcome: refused + failed === 0 ? 'SUCCESS' : 'FAILURE',
      ipAddress: actor.ip,
      userAgent: actor.userAgent,
      newValues: { newlyPublished, failed, refused, skipped, refusalCodes, overrideRequested: opts.allowUnreviewedSource === true },
    });

    return {
      batchId,
      newlyPublished,
      failed,
      refused,
      refusalCodes,
      skipped,
      totalBatchRecords: records.length,
    };
  }

  /**
   * Retrieves paginated batch history
   */
  async getBatches(limit = 20, offset = 0) {
    return this.batchRepo.findAll(limit, offset);
  }

  /**
   * Returns real database statistics for Admin Data Quality Dashboard
   */
  async getRealStats() {
    const [publishedCountRes, draftCountRes, batchStatsRes] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.businesses)
        .where(eq(schema.businesses.status, 'PUBLISHED')),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.businesses)
        .where(eq(schema.businesses.status, 'DRAFT')),
      this.db
        .select({
          totalBatches: sql<number>`count(*)::int`,
          totalRecords: sql<number>`coalesce(sum(${schema.importBatches.totalRecords}), 0)::int`,
          totalProcessed: sql<number>`coalesce(sum(${schema.importBatches.processedRecords}), 0)::int`,
          totalSuccessful: sql<number>`coalesce(sum(${schema.importBatches.successfulRecords}), 0)::int`,
          totalFailed: sql<number>`coalesce(sum(${schema.importBatches.failedRecords}), 0)::int`,
          totalDuplicates: sql<number>`coalesce(sum(${schema.importBatches.duplicateRecords}), 0)::int`,
        })
        .from(schema.importBatches),
    ]);

    const published = publishedCountRes[0]?.count || 0;
    const draft = draftCountRes[0]?.count || 0;
    const bStats = batchStatsRes[0] || {
      totalBatches: 0,
      totalRecords: 0,
      totalProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      totalDuplicates: 0,
    };

    return {
      publishedBusinesses: published,
      draftBusinesses: draft,
      totalBusinesses: published + draft,
      totalBatches: bStats.totalBatches,
      totalRecordsIngested: bStats.totalRecords,
      totalSuccessful: bStats.totalSuccessful,
      totalFailed: bStats.totalFailed,
      totalDuplicates: bStats.totalDuplicates,
    };
  }
}
