import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import {
  ImportBatchRepository,
  ImportRecordRepository,
  ValidationLogRepository,
} from './repositories/import.repositories';
import {
  DuplicateRepository,
  ReviewQueueRepository,
  PublishQueueRepository,
} from './repositories/duplicate-review.repositories';
import { NormalizationService } from './services/normalization.service';
import { ValidationService } from './services/validation.service';
import { DuplicateDetectionService } from './services/duplicate-detection.service';
import { ReviewService } from './services/review.service';
import { PublishingService } from './services/publishing.service';
import { ImportPipelineService } from './services/import-pipeline.service';
import { ImportBatchWorker } from './workers/import-batch.worker';
import { PublishWorker } from './workers/publish.worker';

import { AdminImportController } from './controllers/admin-import.controller';
import { AdminImportService } from './services/admin-import.service';

@Module({
  imports: [BusinessModule],
  controllers: [AdminImportController],
  providers: [
    ImportBatchRepository,
    ImportRecordRepository,
    ValidationLogRepository,
    DuplicateRepository,
    ReviewQueueRepository,
    PublishQueueRepository,
    NormalizationService,
    ValidationService,
    DuplicateDetectionService,
    ReviewService,
    PublishingService,
    ImportPipelineService,
    AdminImportService,
    ImportBatchWorker,
    PublishWorker,
  ],
  exports: [
    ImportBatchRepository,
    ImportRecordRepository,
    ValidationLogRepository,
    DuplicateRepository,
    ReviewQueueRepository,
    PublishQueueRepository,
    NormalizationService,
    ValidationService,
    DuplicateDetectionService,
    ReviewService,
    PublishingService,
    ImportPipelineService,
    AdminImportService,
    ImportBatchWorker,
    PublishWorker,
  ],
})
export class ImportModule {}
