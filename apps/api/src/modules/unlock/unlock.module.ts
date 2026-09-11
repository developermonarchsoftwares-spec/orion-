import { Module } from '@nestjs/common';
import { UnlockController } from './unlock.controller';
import { UnlockService } from './unlock.service';
import { UnlockRepository } from './unlock.repository';
import { CreditModule } from '../credit/credit.module';
import { DiscoverModule } from '../discover/discover.module';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [CreditModule, DiscoverModule, BusinessModule],
  controllers: [UnlockController],
  providers: [UnlockRepository, UnlockService],
  exports: [UnlockRepository, UnlockService],
})
export class UnlockModule {}
