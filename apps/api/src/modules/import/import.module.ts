import { Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { PeopleModule } from '../people/people.module';
import { ImportPeopleBridge } from './people/import-people.bridge';
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
import { SourceTrustService } from './services/source-trust.service';
import { ImportSourcesController } from './controllers/import-sources.controller';
import { ImportOperationsController } from './controllers/import-operations.controller';
import { ImportRecoveryController } from './controllers/import-recovery.controller';
import { ImportOperationsService } from './services/import-operations.service';
import { ImportRecoveryService } from './services/import-recovery.service';

@Module({
  imports: [BusinessModule, PeopleModule],
  controllers: [AdminImportController, ImportOperationsController, ImportRecoveryController, ImportSourcesController],
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
    SourceTrustService,
    ImportPipelineService,
    AdminImportService,
    ImportOperationsService,
    ImportRecoveryService,
    ImportPeopleBridge,
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
    SourceTrustService,
    ImportPipelineService,
    AdminImportService,
    ImportBatchWorker,
    PublishWorker,
  ],
})
export class ImportModule {}
