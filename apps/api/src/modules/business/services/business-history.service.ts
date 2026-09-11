import { Injectable, Logger } from '@nestjs/common';
import { BusinessHistoryRepository } from '../repositories/business-metrics-scores.repository';

export interface ILogHistoryOptions {
  businessId: string;
  changedById?: string;
  changeType: 'INITIAL_CREATION' | 'DATA_IMPORT' | 'ENRICHMENT' | 'MANUAL_EDIT' | 'MERGE' | 'STATUS_CHANGE';
  fieldName?: string;
  oldValue?: string;
  newValue?: string;
  fullSnapshot: Record<string, unknown>;
  changeReason?: string;
  sourceBatchId?: string;
}

@Injectable()
export class BusinessHistoryService {
  private readonly logger = new Logger(BusinessHistoryService.name);

  constructor(private readonly historyRepo: BusinessHistoryRepository) {}

  async logChange(options: ILogHistoryOptions) {
    this.logger.debug(
      `Logging business change [${options.changeType}] for business ${options.businessId}`,
    );

    return this.historyRepo.create({
      businessId: options.businessId,
      changedById: options.changedById,
      changeType: options.changeType,
      fieldName: options.fieldName,
      oldValue: options.oldValue,
      newValue: options.newValue,
      fullSnapshot: options.fullSnapshot,
      changeReason: options.changeReason,
      sourceBatchId: options.sourceBatchId,
    });
  }

  async getHistory(businessId: string, limit = 50) {
    return this.historyRepo.findByBusinessId(businessId, limit);
  }
}
