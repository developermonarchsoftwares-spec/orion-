import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ContactSuppressionService } from './contact-suppression.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyScheduler } from './privacy.scheduler';
import { PrivacyService } from './privacy.service';

@Module({
  imports: [AuthModule], // PasswordService (confirm a deletion) and MailService (notice)
  controllers: [PrivacyController],
  providers: [PrivacyService, PrivacyScheduler, ContactSuppressionService],
  exports: [PrivacyService, ContactSuppressionService],
})
export class PrivacyModule {}
