import { Module } from '@nestjs/common';
import { DiscoverController } from './discover.controller';
import { BusinessController } from '../business/business.controller';
import { DiscoverService } from './discover.service';
import { SearchModule } from '../search/search.module';
import { BusinessModule } from '../business/business.module';
import { PeopleModule } from '../people/people.module';

@Module({
  imports: [SearchModule, BusinessModule, PeopleModule],
  controllers: [DiscoverController, BusinessController],
  providers: [DiscoverService],
  exports: [DiscoverService],
})
export class DiscoverModule {}
