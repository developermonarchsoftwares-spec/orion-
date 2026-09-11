import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { GoogleOAuthProvider } from './providers/google.provider';
import { MicrosoftOAuthProvider } from './providers/microsoft.provider';
import { OAuthStateService } from './services/oauth-state.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [ConfigModule, UserModule],
  controllers: [OAuthController],
  providers: [
    OAuthService,
    OAuthStateService,
    GoogleOAuthProvider,
    MicrosoftOAuthProvider,
  ],
  exports: [OAuthService],
})
export class OAuthModule {}
