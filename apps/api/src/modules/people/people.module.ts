import { Module } from '@nestjs/common';
import { CompanyResolutionModule } from '../business/company-resolution/company-resolution.module';
import { CreditModule } from '../credit/credit.module';
import { PEOPLE_INGESTION_PORT } from './contracts/people-ingestion.contract';
import { PEOPLE_INGESTION_SERVICE } from './ingestion/ingestion.types';
import { PeopleIngestionService } from './ingestion/people-ingestion.service';
import { PeopleBundleImportController } from './ingestion/bundle/people-bundle-import.controller';
import { PeopleBundleImportService } from './ingestion/bundle/people-bundle-import.service';
import { PeopleExportImportController } from './ingestion/people-export-import.controller';
import { PeopleExportImportService } from './ingestion/people-export-import.service';
import { PeopleImportJobService } from './ingestion/people-import-job.service';
import { PeoplePublishingService } from './people-publishing.service';
import { PeopleController } from './people.controller';
import { PeopleQuarantineService } from './review/people-quarantine.service';
import { PeopleReviewController } from './review/people-review.controller';
import { PeopleVerificationController } from './verification/people-verification.controller';
import { PeopleVerificationService } from './verification/people-verification.service';
import { PeopleReviewService } from './review/people-review.service';
import { PeopleMetricsController } from './metrics/metrics.controller';
import { PeopleMetricsService } from './metrics/people-metrics.service';
import { PeopleTriageService } from './review/people-triage.service';
import { PeopleExportService } from './people-export.service';
import { PeopleSearchService } from './people-search.service';
import { PeopleService } from './people.service';
import { PeopleUnlockService } from './people-unlock.service';
import { AcquisitionOrchestratorService } from './acquisition/acquisition-orchestrator.service';
import { RoleClassificationService } from './classification/role-classification.service';
import { PeopleWriteService } from './people-write.service';
import { ObservationService } from './observations/observation.service';
import { SourceRegistryService } from './sources/source-registry.service';

@Module({
  imports: [CreditModule, CompanyResolutionModule],
  controllers: [PeopleController, PeopleReviewController, PeopleVerificationController, PeopleMetricsController, PeopleExportImportController, PeopleBundleImportController],
  providers: [
    PeopleService,
    PeopleUnlockService,
    PeopleExportService,
    PeopleSearchService,
    RoleClassificationService,
    PeopleWriteService,
    PeopleIngestionService,
    PeopleExportImportService,
    PeopleImportJobService,
    PeopleBundleImportService,
    PeoplePublishingService,
    PeopleReviewService,
    PeopleTriageService,
    PeopleMetricsService,
    PeopleVerificationService,
    SourceRegistryService,
    ObservationService,
    AcquisitionOrchestratorService,
    PeopleQuarantineService,
    { provide: PEOPLE_INGESTION_SERVICE, useExisting: PeopleIngestionService },
    // Phase 2 pipeline stages depend on this token, not on the concrete class.
    { provide: PEOPLE_INGESTION_PORT, useExisting: PeopleWriteService },
  ],
  exports: [
    PeopleService,
    PeopleExportService,
    PeopleSearchService,
    PEOPLE_INGESTION_PORT,
    PEOPLE_INGESTION_SERVICE,
    PeopleWriteService,
    PeopleIngestionService,
    PeoplePublishingService,
    AcquisitionOrchestratorService,
  ],
})
export class PeopleModule {}
