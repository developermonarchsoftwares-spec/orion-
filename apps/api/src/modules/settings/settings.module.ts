import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { ApiKeyService } from './services/api-key.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [SettingsController],
  providers: [SettingsService, ApiKeyService],
  exports: [SettingsService, ApiKeyService],
})
export class SettingsModule {}
