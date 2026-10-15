import { OAuthService } from '../oauth.service';
import { IOAuthProvider, IOAuthUserProfile } from '../interfaces/oauth-provider.interface';
import { OAuthStateService } from '../services/oauth-state.service';
import { BusinessException } from '../../../common/errors/business.exception';

describe('SG-03: OAuth verified email enforcement (OAuthService)', () => {
  let oauthService: OAuthService;
  let mockProvider: jest.Mocked<IOAuthProvider>;
  let mockStateService: Partial<OAuthStateService>;
  let mockUserRepo: any;
  let mockTokenService: any;
  let mockDb: any;

  beforeEach(() => {
    mockProvider = {
      name: 'GOOGLE',
      getAuthorizationUrl: jest.fn(),
      exchangeCode: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      }),
      getUserProfile: jest.fn(),
    };

    mockStateService = {
      verifyState: jest.fn().mockReturnValue({
        valid: true,
        payload: { provider: 'GOOGLE', codeVerifier: 'verifier-123' },
      }),
    };

    mockUserRepo = {
      findById: jest.fn(),
      findByGoogleId: jest.fn().mockResolvedValue(null),
      findByMicrosoftId: jest.fn().mockResolvedValue(null),
      findByEmail: jest.fn().mockResolvedValue(null),
      linkGoogle: jest.fn(),
      linkMicrosoft: jest.fn(),
      updateById: jest.fn(),
      createRefreshToken: jest.fn().mockResolvedValue(undefined),
    };

    mockTokenService = {
      generateTokenPair: jest.fn().mockResolvedValue({
        accessToken: 'mock-jwt-access',
        refreshToken: 'mock-jwt-refresh',
        expiresIn: 900,
      }),
    };

    mockDb = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        return cb({
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([
                { id: 'new-user-1', email: 'verified@example.com', role: 'USER', status: 'ACTIVE', provider: 'GOOGLE' },
              ]),
            }),
          }),
        });
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockResolvedValue(undefined),
      }),
    };

    oauthService = new OAuthService(
      { get: jest.fn() } as any,
      mockProvider as any,
      mockProvider as any,
      mockStateService as any,
      mockUserRepo,
      mockTokenService,
      mockDb,
    );
  });

  it('rejects OAuth callback when provider returns isEmailVerified: false (SG-03 prevention)', async () => {
    mockProvider.getUserProfile.mockResolvedValue({
      provider: 'GOOGLE',
      providerId: 'unverified-sub-123',
      email: 'attacker@example.com',
      firstName: 'Attacker',
      lastName: 'User',
      displayName: 'Attacker User',
      isEmailVerified: false,
    });

    await expect(
      oauthService.handleCallback('google', 'valid-code-123', 'valid-state-123'),
    ).rejects.toMatchObject({
      errorCode: 'OAUTH_EMAIL_UNVERIFIED',
      status: 403,
    });
  });

  it('rejects OAuth callback when provider returns an empty or missing email', async () => {
    mockProvider.getUserProfile.mockResolvedValue({
      provider: 'GOOGLE',
      providerId: 'noemail-sub-123',
      email: '',
      firstName: 'NoEmail',
      lastName: 'User',
      displayName: 'NoEmail User',
      isEmailVerified: true,
    });

    await expect(
      oauthService.handleCallback('google', 'valid-code-123', 'valid-state-123'),
    ).rejects.toMatchObject({
      errorCode: 'OAUTH_EMAIL_MISSING',
      status: 400,
    });
  });

  it('permits OAuth sign-in and provisioning when provider email is verified', async () => {
    mockProvider.getUserProfile.mockResolvedValue({
      provider: 'GOOGLE',
      providerId: 'verified-sub-456',
      email: 'verified@example.com',
      firstName: 'Legit',
      lastName: 'User',
      displayName: 'Legit User',
      isEmailVerified: true,
    });

    const result = await oauthService.handleCallback('google', 'valid-code-123', 'valid-state-123');
    expect(result.isNewUser).toBe(true);
    expect(result.tokens.accessToken).toBe('mock-jwt-access');
  });

  it('safely links an existing user when OAuth email matches and is verified', async () => {
    mockUserRepo.findByEmail.mockResolvedValue({
      id: 'existing-user-99',
      email: 'existing@example.com',
      role: 'USER',
      status: 'ACTIVE',
      isEmailVerified: false,
    });

    mockUserRepo.linkGoogle.mockResolvedValue({
      id: 'existing-user-99',
      email: 'existing@example.com',
      googleId: 'verified-sub-99',
      role: 'USER',
      status: 'ACTIVE',
      isEmailVerified: false,
    });

    mockProvider.getUserProfile.mockResolvedValue({
      provider: 'GOOGLE',
      providerId: 'verified-sub-99',
      email: 'existing@example.com',
      firstName: 'Existing',
      lastName: 'Owner',
      displayName: 'Existing Owner',
      isEmailVerified: true,
    });

    const result = await oauthService.handleCallback('google', 'valid-code-123', 'valid-state-123');
    expect(result.linkedExisting).toBe(true);
    expect(mockUserRepo.linkGoogle).toHaveBeenCalledWith('existing-user-99', 'verified-sub-99', undefined);
    expect(mockUserRepo.updateById).toHaveBeenCalledWith('existing-user-99', expect.objectContaining({ isEmailVerified: true }));
  });
});
