import { Module } from '@nestjs/common';
import { PeopleModule } from '../people/people.module';
import { ExportController } from './export.controller';
import { ExportSchedulerService } from './export-scheduler.service';
import { ExportService } from './export.service';

@Module({
  imports: [PeopleModule],
  controllers: [ExportController],
  providers: [ExportService, ExportSchedulerService],
  exports: [ExportService, ExportSchedulerService],
})
export class ExportModule {}
