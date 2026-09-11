import { Module } from '@nestjs/common';
import { TaxonomyRepository } from './repositories/taxonomy.repository';
import { BusinessRepository } from './repositories/business.repository';
import {
  BusinessLocationRepository,
  BusinessContactRepository,
  DigitalPresenceRepository,
} from './repositories/business-details.repository';
import { BusinessIdentifierRepository } from './repositories/business-identifier.repository';
import {
  BusinessMetricsRepository,
  BusinessScoreRepository,
  BusinessHistoryRepository,
} from './repositories/business-metrics-scores.repository';
import { BusinessScoringService } from './services/business-scoring.service';
import { BusinessHistoryService } from './services/business-history.service';
import { BusinessService } from './services/business.service';

@Module({
  providers: [
    TaxonomyRepository,
    BusinessRepository,
    BusinessLocationRepository,
    BusinessContactRepository,
    DigitalPresenceRepository,
    BusinessIdentifierRepository,
    BusinessMetricsRepository,
    BusinessScoreRepository,
    BusinessHistoryRepository,
    BusinessScoringService,
    BusinessHistoryService,
    BusinessService,
  ],
  exports: [
    TaxonomyRepository,
    BusinessRepository,
    BusinessLocationRepository,
    BusinessContactRepository,
    DigitalPresenceRepository,
    BusinessIdentifierRepository,
    BusinessMetricsRepository,
    BusinessScoreRepository,
    BusinessHistoryRepository,
    BusinessScoringService,
    BusinessHistoryService,
    BusinessService,
  ],
})
export class BusinessModule {}
