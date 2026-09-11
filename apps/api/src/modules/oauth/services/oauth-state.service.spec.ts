import { ConfigService } from '@nestjs/config';
import { OAuthStateService } from './oauth-state.service';

describe('OAuthStateService (Unit Tests)', () => {
  let service: OAuthStateService;
  let mockConfigService: Partial<ConfigService>;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultVal?: any) => {
        if (key === 'JWT_ACCESS_SECRET') return 'test-hmac-secret-key-32-chars-length';
        return defaultVal;
      }),
    };
    service = new OAuthStateService(mockConfigService as ConfigService);
  });

  describe('generatePKCE', () => {
    it('should generate a codeVerifier and a SHA256 codeChallenge', () => {
      const pkce = service.generatePKCE();
      expect(pkce.codeVerifier).toBeDefined();
      expect(pkce.codeChallenge).toBeDefined();
      expect(typeof pkce.codeVerifier).toBe('string');
      expect(typeof pkce.codeChallenge).toBe('string');
      expect(pkce.codeVerifier.length).toBeGreaterThan(20);
    });
  });

  describe('generateState & verifyState', () => {
    it('should generate a valid signed state parameter and successfully verify it', () => {
      const { state, codeVerifier, codeChallenge } = service.generateState('GOOGLE');
      expect(state).toContain('.');

      const result = service.verifyState(state);
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.payload?.provider).toBe('GOOGLE');
      expect(result.payload?.codeVerifier).toBe(codeVerifier);
    });

    it('should reject tampered state signatures', () => {
      const { state } = service.generateState('GOOGLE');
      const [payload, _signature] = state.split('.');
      const tamperedState = `${payload}.invalid-tampered-signature`;

      const result = service.verifyState(tamperedState);
      expect(result.valid).toBe(false);
      expect(result.payload).toBeUndefined();
    });

    it('should strictly prevent replay attacks when state is verified a second time', () => {
      const { state } = service.generateState('GOOGLE');

      // First verification succeeds
      const firstResult = service.verifyState(state);
      expect(firstResult.valid).toBe(true);

      // Second verification of the exact same state MUST fail
      const secondResult = service.verifyState(state);
      expect(secondResult.valid).toBe(false);
      expect(secondResult.payload).toBeUndefined();
    });

    it('should reject empty or malformed state tokens', () => {
      expect(service.verifyState('').valid).toBe(false);
      expect(service.verifyState('no-dot-token').valid).toBe(false);
    });
  });
});
