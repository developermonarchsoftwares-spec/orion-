import { BusinessException } from '../../../common/errors/business.exception';
import { Injectable, Logger } from '@nestjs/common';
import { ImportBatchRepository, ImportRecordRepository, ValidationLogRepository } from '../repositories/import.repositories';
import { DuplicateRepository, ReviewQueueRepository, PublishQueueRepository } from '../repositories/duplicate-review.repositories';
import { NormalizationService } from './normalization.service';
import { ValidationService } from './validation.service';
import { DuplicateDetectionService } from './duplicate-detection.service';
import { PublishingService } from './publishing.service';
import { emptyPeopleSummary, IPeopleIngestionSummary } from '../people/import-people.types';

@Injectable()
export class ImportPipelineService {
  private readonly logger = new Logger(ImportPipelineService.name);

  constructor(
    private readonly batchRepo: ImportBatchRepository,
    private readonly recordRepo: ImportRecordRepository,
    private readonly validationLogRepo: ValidationLogRepository,
    private readonly duplicateRepo: DuplicateRepository,
    private readonly reviewRepo: ReviewQueueRepository,
    private readonly publishRepo: PublishQueueRepository,
    private readonly normalizationService: NormalizationService,
    private readonly validationService: ValidationService,
    private readonly duplicateService: DuplicateDetectionService,
    private readonly publishingService: PublishingService,
  ) {}

  /**
   * Processes a single import record through the complete ingestion pipeline
   */
  async processRecord(recordId: string) {
    const record = await this.recordRepo.findById(recordId);
    if (!record) {
      throw new Error(`Record ${recordId} not found`);
    }

    const rawPayload = record.rawPayload as Record<string, unknown>;

    // 1. Normalization Stage
    const normalized = this.normalizationService.normalizeRecord(rawPayload);
     
    await this.recordRepo.updateStatus(record.id, 'NORMALIZED', normalized as any);

    // 2. Validation Stage
    const validation = this.validationService.validateRecord(normalized);

    // Log validation logs
    if (validation.logs.length > 0) {
      await this.validationLogRepo.createMany(
        validation.logs.map((log) => ({
          recordId: record.id,
          ruleName: log.ruleName,
          field: log.field,
          severity: log.severity,
          message: log.message,
          passed: log.passed,
          metadata: log.metadata,
        })),
      );
    }

    if (!validation.isValid) {
      this.logger.warn(`Record ${record.id} failed validation rules`);
       
      await this.recordRepo.updateStatus(record.id, 'FAILED', normalized as any, {
        validationLogs: validation.logs,
      });
      return { status: 'FAILED', reason: 'Validation failed' };
    }

    // 3. Duplicate Detection Stage
    const duplicateMatches = await this.duplicateService.detectDuplicates(normalized);

    if (duplicateMatches.length > 0) {
      this.logger.log(`Record ${record.id} matched ${duplicateMatches.length} existing duplicate candidates`);
       
      await this.recordRepo.updateStatus(record.id, 'FLAGGED_DUPLICATE', normalized as any);

      // Create duplicate cluster
      const cluster = await this.duplicateRepo.createCluster({
        clusterKey: `dup-${record.id.substring(0, 8)}`,
        primaryBusinessId: duplicateMatches[0].matchedBusinessId,
        totalCandidates: duplicateMatches.length,
        status: 'PENDING',
      });

      // Insert candidates
      await this.duplicateRepo.createCandidates(
        duplicateMatches.map((m) => ({
          clusterId: cluster.id,
          recordId: record.id,
          matchedBusinessId: m.matchedBusinessId,
          confidenceScore: m.confidenceScore.toString(),
          matchType: m.matchType,
          matchDetails: m.matchDetails,
        })),
      );

      // Enqueue in Manual Review Queue
      await this.reviewRepo.enqueue({
        recordId: record.id,
        clusterId: cluster.id,
        priority: 10,
        status: 'PENDING',
      });

      return { status: 'FLAGGED_DUPLICATE', clusterId: cluster.id };
    }

    // 4. If clean and approved -> Enqueue for Publishing
     
    await this.recordRepo.updateStatus(record.id, 'APPROVED', normalized as any);
    const publishItem = await this.publishRepo.enqueue({
      recordId: record.id,
      publishMode: 'CREATE',
      status: 'PENDING',
    });

    // 5. Publication is an explicit administrator step (Phase 15). The record waits in the publish queue; it is published here only when the
    // batch asked for automatic publication AND its source is approved. A refusal (unreviewed source, revoked source, failed re-validation)
    // leaves the record queued for an administrator and is audited by the publisher.
    const batch = await this.batchRepo.findById(record.batchId);
    if ((batch?.options as { autoPublish?: boolean } | null)?.autoPublish === true) {
      try {
        const publishedBusiness = await this.publishingService.publishRecord(publishItem.id, { via: 'AUTO' });
        return { status: 'PUBLISHED', businessId: publishedBusiness.id };
      } catch (err) {
        if (!(err instanceof BusinessException)) throw err;
        return { status: 'AWAITING_PUBLISH', reason: err.errorCode };
      }
    }
    return { status: 'AWAITING_PUBLISH', reason: 'ADMIN_PUBLISH_REQUIRED' };
  }

  /**
   * Processes all records in a batch
   */
  async processBatch(batchId: string) {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    this.logger.log(`Starting ingestion pipeline for batch: ${batch.filename} (ID: ${batch.id})`);
    await this.batchRepo.updateStats(batch.id, { status: 'PROCESSING' });

    const records = await this.recordRepo.findByBatchId(batch.id, 1000);
    let successful = 0;
    let failed = 0;
    let duplicates = 0;
    let queued = 0;

    for (const rec of records) {
      try {
        const result = await this.processRecord(rec.id);
        if (result.status === 'PUBLISHED') successful++;
        else if (result.status === 'FLAGGED_DUPLICATE') duplicates++;
        else if (result.status === 'AWAITING_PUBLISH') queued++;
        else failed++;
      } catch (err) {
        this.logger.error(`Error processing record ${rec.id}: ${(err as Error).message}`);
        failed++;
      }
    }

    await this.batchRepo.updateStats(batch.id, {
      processedRecords: records.length,
      successfulRecords: successful,
      failedRecords: failed,
      duplicateRecords: duplicates,
      status: failed === records.length ? 'FAILED' : 'COMPLETED',
      completedAt: new Date(),
    });

    this.logger.log(
      `Completed batch ${batch.id}: ${successful} published, ${queued} awaiting publication, ${duplicates} duplicates, ${failed} failed`,
    );

    // People-stage outcome (written per record by ImportPeopleBridge). When no row reached the People stage the summary is still
    // persisted (all zero) so it is never null for a processed batch.
    let finished = await this.batchRepo.findById(batch.id);
    if (!finished?.peopleSummary) {
      await this.batchRepo.setPeopleSummary(batch.id, emptyPeopleSummary());
      finished = await this.batchRepo.findById(batch.id);
    }

    return {
      batchId,
      total: records.length,
      successful,
      queued,
      duplicates,
      failed,
      people: (finished?.peopleSummary as IPeopleIngestionSummary | null) ?? emptyPeopleSummary(),
    };
  }
}
