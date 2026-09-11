import { Module } from '@nestjs/common';
import { SavedLeadsController } from './saved-leads.controller';
import { SavedLeadsService } from './saved-leads.service';
import { SavedLeadsRepository } from './saved-leads.repository';

@Module({
  controllers: [SavedLeadsController],
  providers: [SavedLeadsRepository, SavedLeadsService],
  exports: [SavedLeadsRepository, SavedLeadsService],
})
export class SavedLeadsModule {}
