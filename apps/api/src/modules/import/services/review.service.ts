import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
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
  ) {}

  async processReviewDecision(input: IReviewDecisionInput) {
    const { reviewId, decision, reviewerId, notes, editedPayload, targetBusinessId } = input;

    // 1. Update review record
    const updatedReview = await this.reviewRepo.updateDecision(
      reviewId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
