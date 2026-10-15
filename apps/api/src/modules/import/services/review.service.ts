import { Inject, Injectable, Logger, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { ValidationService } from './validation.service';
import { INormalizedRecordResult } from './normalization.service';
import { ReviewQueueRepository, PublishQueueRepository } from '../repositories/duplicate-review.repositories';
import { ImportRecordRepository } from '../repositories/import.repositories';
import { ReviewAction } from '@orion/shared';

export interface IReviewDecisionInput {
  reviewId: string;
  decision: ReviewAction;
  reviewerId: string;
  notes?: string;
  editedPayload?: Record<string, unknown>;
  targetBusinessId?: string;
}

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly reviewRepo: ReviewQueueRepository,
    private readonly publishRepo: PublishQueueRepository,
    private readonly recordRepo: ImportRecordRepository,
    private readonly validation: ValidationService,
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  async processReviewDecision(input: IReviewDecisionInput) {
    const { reviewId, decision, reviewerId, notes, editedPayload, targetBusinessId } = input;

    // Phase 15: nothing an administrator types in, or points at, skips validation or lands on a business that is not there.
    if (decision === ReviewAction.EDIT) {
      if (!editedPayload) throw new BadRequestException('An edited payload is required for the EDIT action');
      const check = this.validation.validateRecord(editedPayload as unknown as INormalizedRecordResult);
      if (!check.isValid) {
        await this.audit?.record({ userId: reviewerId, action: 'IMPORT_REVIEW_REFUSED', entityType: 'REVIEW_QUEUE', entityId: reviewId, outcome: 'DENIED', failureCategory: 'EDIT_FAILED_VALIDATION', newValues: { failedRules: check.logs.filter((l) => !l.passed && l.severity === 'ERROR').map((l) => l.ruleName).slice(0, 10) } });
        throw new BadRequestException('The edited record does not pass validation');
      }
    }
    if (decision === ReviewAction.MERGE && targetBusinessId) {
      const [target] = await this.db.select({ id: schema.businesses.id }).from(schema.businesses).where(eq(schema.businesses.id, targetBusinessId)).limit(1);
      if (!target) throw new BadRequestException('The business to merge into does not exist');
    }

    // 1. Update review record
    const updatedReview = await this.reviewRepo.updateDecision(
      reviewId,
       
      decision as any,
      reviewerId,
      notes,
      editedPayload,
    );

    if (!updatedReview) {
      throw new NotFoundException(`Review queue item '${reviewId}' not found`);
    }

    const record = await this.recordRepo.findById(updatedReview.recordId);
    if (!record) {
      throw new NotFoundException(`Import record '${updatedReview.recordId}' not found`);
    }

    // 2. Route action
    switch (decision) {
      case ReviewAction.APPROVE:
        await this.recordRepo.updateStatus(record.id, 'APPROVED');
        await this.publishRepo.enqueue({
          recordId: record.id,
          publishMode: 'CREATE',
          status: 'PENDING',
        });
        break;

      case ReviewAction.REJECT:
        await this.recordRepo.updateStatus(record.id, 'REJECTED');
        break;

      case ReviewAction.MERGE:
        if (!targetBusinessId) {
          throw new BadRequestException('Target business ID is required for MERGE action');
        }
        await this.recordRepo.updateStatus(record.id, 'MERGED');
        await this.publishRepo.enqueue({
          recordId: record.id,
          targetBusinessId,
          publishMode: 'MERGE',
          status: 'PENDING',
        });
        break;

      case ReviewAction.EDIT:
        await this.recordRepo.updateStatus(record.id, 'APPROVED', editedPayload);
        await this.publishRepo.enqueue({
          recordId: record.id,
          publishMode: 'CREATE',
          status: 'PENDING',
        });
        break;

      case ReviewAction.PUBLISH:
        await this.recordRepo.updateStatus(record.id, 'APPROVED');
        await this.publishRepo.enqueue({
          recordId: record.id,
          publishMode: 'CREATE',
          status: 'PENDING',
        });
        break;
    }

    await this.audit?.record({
      userId: reviewerId,
      action: 'IMPORT_REVIEW_DECISION',
      entityType: 'IMPORT_RECORD',
      entityId: record.id,
      outcome: 'SUCCESS',
      newValues: { decision, reviewId, clusterId: updatedReview.clusterId ?? null, targetBusinessId: targetBusinessId ?? null, edited: decision === ReviewAction.EDIT },
    });
    this.logger.log(
      `Processed review decision [${decision}] for record ${record.id} by reviewer ${reviewerId}`,
    );

    return {
      success: true,
      reviewId,
      decision,
      recordId: record.id,
    };
  }
}
