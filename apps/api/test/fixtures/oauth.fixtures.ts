import { IOAuthUserProfile, IOAuthTokens } from '../../src/modules/oauth/interfaces/oauth-provider.interface';

export const OAUTH_FIXTURES = {
  google: {
    newUser: {
      profile: {
        provider: 'GOOGLE',
        providerId: 'google-test-id-10001',
        email: 'test.google.new@orion-test.io',
        firstName: 'GoogleNew',
        lastName: 'Developer',
        displayName: 'GoogleNew Developer',
        avatarUrl: 'https://lh3.googleusercontent.com/a/test-avatar-new',
        isEmailVerified: true,
      } as IOAuthUserProfile,
      code: 'valid-google-new-user-auth-code',
      tokens: {
        accessToken: 'mock-google-new-access-token-xyz',
        idToken: 'mock-google-new-id-token-abc',
        tokenType: 'Bearer',
        expiresIn: 3600,
      } as IOAuthTokens,
    },
    existingUserSameEmail: {
      profile: {
        provider: 'GOOGLE',
        providerId: 'google-test-id-10002',
        email: 'existing.email.user@orion-test.io',
        firstName: 'ExistingEmail',
        lastName: 'User',
        displayName: 'ExistingEmail User',
        avatarUrl: 'https://lh3.googleusercontent.com/a/test-avatar-existing',
        isEmailVerified: true,
      } as IOAuthUserProfile,
      code: 'valid-google-existing-email-code',
      tokens: {
        accessToken: 'mock-google-existing-access-token-xyz',
        idToken: 'mock-google-existing-id-token-abc',
        tokenType: 'Bearer',
        expiresIn: 3600,
      } as IOAuthTokens,
    },
    existingOAuthUser: {
      profile: {
        provider: 'GOOGLE',
        providerId: 'google-test-id-10003',
        email: 'existing.google.user@orion-test.io',
        firstName: 'ExistingGoogle',
        lastName: 'User',
        displayName: 'ExistingGoogle User',
        avatarUrl: 'https://lh3.googleusercontent.com/a/test-avatar-oauth',
        isEmailVerified: true,
      } as IOAuthUserProfile,
      code: 'valid-google-existing-oauth-code',
      tokens: {
        accessToken: 'mock-google-oauth-access-token-xyz',
        idToken: 'mock-google-oauth-id-token-abc',
        tokenType: 'Bearer',
        expiresIn: 3600,
      } as IOAuthTokens,
    },
  },
  microsoft: {
    newUser: {
      profile: {
        provider: 'MICROSOFT',
        providerId: 'microsoft-test-id-20001',
        email: 'test.microsoft.new@orion-test.io',
        firstName: 'MsNew',
        lastName: 'Developer',
        displayName: 'MsNew Developer',
        avatarUrl: 'https://graph.microsoft.com/v1.0/me/photo/$value',
        isEmailVerified: true,
      } as IOAuthUserProfile,
      code: 'valid-microsoft-new-user-auth-code',
      tokens: {
        accessToken: 'mock-microsoft-new-access-token-xyz',
        idToken: 'mock-microsoft-new-id-token-abc',
        tokenType: 'Bearer',
        expiresIn: 3600,
      } as IOAuthTokens,
    },
    existingUserSameEmail: {
      profile: {
        provider: 'MICROSOFT',
        providerId: 'microsoft-test-id-20002',
        email: 'existing.ms.email@orion-test.io',
        firstName: 'ExistingMsEmail',
        lastName: 'User',
        displayName: 'ExistingMsEmail User',
        avatarUrl: 'https://graph.microsoft.com/v1.0/me/photo/$value',
        isEmailVerified: true,
      } as IOAuthUserProfile,
      code: 'valid-microsoft-existing-email-code',
      tokens: {
        accessToken: 'mock-microsoft-existing-access-token-xyz',
        idToken: 'mock-microsoft-existing-id-token-abc',
        tokenType: 'Bearer',
        expiresIn: 3600,
      } as IOAuthTokens,
    },
    existingOAuthUser: {
      profile: {
        provider: 'MICROSOFT',
        providerId: 'microsoft-test-id-20003',
        email: 'existing.microsoft.user@orion-test.io',
        firstName: 'ExistingMicrosoft',
        lastName: 'User',
        displayName: 'ExistingMicrosoft User',
        avatarUrl: 'https://graph.microsoft.com/v1.0/me/photo/$value',
        isEmailVerified: true,
      } as IOAuthUserProfile,
      code: 'valid-microsoft-existing-oauth-code',
      tokens: {
        accessToken: 'mock-microsoft-oauth-access-token-xyz',
        idToken: 'mock-microsoft-oauth-id-token-abc',
        tokenType: 'Bearer',
        expiresIn: 3600,
      } as IOAuthTokens,
    },
  },
};
