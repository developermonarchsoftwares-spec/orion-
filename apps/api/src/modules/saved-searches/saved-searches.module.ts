import { Module } from '@nestjs/common';
import { SavedSearchesController } from './saved-searches.controller';
import { SavedSearchesService } from './saved-searches.service';
import { SavedSearchesRepository } from './saved-searches.repository';
import { DiscoverModule } from '../discover/discover.module';

@Module({
  imports: [DiscoverModule],
  controllers: [SavedSearchesController],
  providers: [SavedSearchesRepository, SavedSearchesService],
  exports: [SavedSearchesRepository, SavedSearchesService],
})
export class SavedSearchesModule {}
