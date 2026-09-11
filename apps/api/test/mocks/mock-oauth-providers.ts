import { Injectable, HttpStatus } from '@nestjs/common';
import { IOAuthProvider, IOAuthTokens, IOAuthUserProfile } from '../../src/modules/oauth/interfaces/oauth-provider.interface';
import { BusinessException } from '../../src/common/errors/business.exception';
import { OAUTH_FIXTURES } from '../fixtures/oauth.fixtures';

@Injectable()
export class MockGoogleOAuthProvider implements IOAuthProvider {
  readonly name = 'GOOGLE';

  getAuthorizationUrl(state: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: 'mock-google-client-id-test.apps.googleusercontent.com',
      redirect_uri: 'http://localhost:4000/api/v1/auth/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });

    if (codeChallenge) {
      params.append('code_challenge', codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string, _codeVerifier?: string): Promise<IOAuthTokens> {
    if (code === 'invalid-auth-code') {
      throw new BusinessException(
        'Invalid authorization code from Google',
        'GOOGLE_CODE_EXCHANGE_FAILED',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (code === OAUTH_FIXTURES.google.newUser.code) {
      return OAUTH_FIXTURES.google.newUser.tokens;
    }
    if (code === OAUTH_FIXTURES.google.existingUserSameEmail.code) {
      return OAUTH_FIXTURES.google.existingUserSameEmail.tokens;
    }
    if (code === OAUTH_FIXTURES.google.existingOAuthUser.code) {
      return OAUTH_FIXTURES.google.existingOAuthUser.tokens;
    }

    // Default mock response for any arbitrary valid test code
    return {
      accessToken: `mock-google-access-token-${code}`,
      idToken: `mock-google-id-token-${code}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  async getUserProfile(accessToken: string, _idToken?: string): Promise<IOAuthUserProfile> {
    if (accessToken === OAUTH_FIXTURES.google.newUser.tokens.accessToken) {
      return OAUTH_FIXTURES.google.newUser.profile;
    }
    if (accessToken === OAUTH_FIXTURES.google.existingUserSameEmail.tokens.accessToken) {
      return OAUTH_FIXTURES.google.existingUserSameEmail.profile;
    }
    if (accessToken === OAUTH_FIXTURES.google.existingOAuthUser.tokens.accessToken) {
      return OAUTH_FIXTURES.google.existingOAuthUser.profile;
    }

    // Default dynamic profile if code wasn't specifically mapped
    return {
      provider: 'GOOGLE',
      providerId: `google-uid-${accessToken.slice(-8)}`,
      email: `user.${accessToken.slice(-6)}@google-mock.test`,
      firstName: 'Mock',
      lastName: 'GoogleUser',
      displayName: 'Mock GoogleUser',
      avatarUrl: 'https://lh3.googleusercontent.com/mock-avatar',
      isEmailVerified: true,
    };
  }
}

@Injectable()
export class MockMicrosoftOAuthProvider implements IOAuthProvider {
  readonly name = 'MICROSOFT';

  getAuthorizationUrl(state: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: 'mock-microsoft-client-id-test',
      response_type: 'code',
      redirect_uri: 'http://localhost:4000/api/v1/auth/microsoft/callback',
      response_mode: 'query',
      scope: 'openid profile email User.Read',
      state,
    });

    if (codeChallenge) {
      params.append('code_challenge', codeChallenge);
      params.append('code_challenge_method', 'S256');
    }

    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, _codeVerifier?: string): Promise<IOAuthTokens> {
    if (code === 'invalid-auth-code') {
      throw new BusinessException(
        'Invalid authorization code from Microsoft',
        'MICROSOFT_CODE_EXCHANGE_FAILED',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (code === OAUTH_FIXTURES.microsoft.newUser.code) {
      return OAUTH_FIXTURES.microsoft.newUser.tokens;
    }
    if (code === OAUTH_FIXTURES.microsoft.existingUserSameEmail.code) {
      return OAUTH_FIXTURES.microsoft.existingUserSameEmail.tokens;
    }
    if (code === OAUTH_FIXTURES.microsoft.existingOAuthUser.code) {
      return OAUTH_FIXTURES.microsoft.existingOAuthUser.tokens;
    }

    return {
      accessToken: `mock-ms-access-token-${code}`,
      idToken: `mock-ms-id-token-${code}`,
      tokenType: 'Bearer',
      expiresIn: 3600,
    };
  }

  async getUserProfile(accessToken: string, _idToken?: string): Promise<IOAuthUserProfile> {
    if (accessToken === OAUTH_FIXTURES.microsoft.newUser.tokens.accessToken) {
      return OAUTH_FIXTURES.microsoft.newUser.profile;
    }
    if (accessToken === OAUTH_FIXTURES.microsoft.existingUserSameEmail.tokens.accessToken) {
      return OAUTH_FIXTURES.microsoft.existingUserSameEmail.profile;
    }
    if (accessToken === OAUTH_FIXTURES.microsoft.existingOAuthUser.tokens.accessToken) {
      return OAUTH_FIXTURES.microsoft.existingOAuthUser.profile;
    }

    return {
      provider: 'MICROSOFT',
      providerId: `microsoft-uid-${accessToken.slice(-8)}`,
      email: `user.${accessToken.slice(-6)}@microsoft-mock.test`,
      firstName: 'Mock',
      lastName: 'MicrosoftUser',
      displayName: 'Mock MicrosoftUser',
      avatarUrl: 'https://graph.microsoft.com/v1.0/me/photo/$value',
      isEmailVerified: true,
    };
  }
}
