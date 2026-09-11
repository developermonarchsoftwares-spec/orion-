import { Module } from '@nestjs/common';
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';
import { CreditRepository } from './credit.repository';
import { CreditScheduler } from './credit.scheduler';

@Module({
  controllers: [CreditController],
  providers: [CreditRepository, CreditService, CreditScheduler],
  exports: [CreditRepository, CreditService],
})
export class CreditModule {}
