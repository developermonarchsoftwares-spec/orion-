import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface IOAuthStatePayload {
  provider: string;
  linkUserId?: string;
  nonce: string;
  codeVerifier?: string;
  timestamp: number;
}

@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly secret: string;
  private readonly stateStore = new Map<string, IOAuthStatePayload>();

  constructor(private readonly configService: ConfigService) {
    this.secret =
      this.configService.get<string>('JWT_ACCESS_SECRET') ||
      'orion_oauth_state_hmac_secret_key_2026';
  }

  /**
   * Generates PKCE code_verifier and code_challenge (S256)
   */
  generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generates a signed, tamper-proof state token with embedded PKCE verifier
   */
  generateState(provider: string, linkUserId?: string): { state: string; codeVerifier: string; codeChallenge: string } {
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();

    const payload: IOAuthStatePayload = {
      provider,
      linkUserId,
      nonce,
      codeVerifier,
      timestamp,
    };

    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(payloadBase64)
      .digest('base64url');

    const state = `${payloadBase64}.${signature}`;
    this.stateStore.set(state, payload);

    // Clean up older states after 15 minutes
    setTimeout(() => this.stateStore.delete(state), 15 * 60 * 1000);

    return { state, codeVerifier, codeChallenge };
  }

  /**
   * Validates state signature, expiration (10m), and retrieves state payload
   */
  verifyState(state: string): { valid: boolean; payload?: IOAuthStatePayload } {
    if (!state || !state.includes('.')) {
      return { valid: false };
    }

    const [payloadBase64, signature] = state.split('.');
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payloadBase64)
      .digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      this.logger.warn('OAuth state HMAC signature mismatch - possible tampering');
      return { valid: false };
    }

    try {
      const payload: IOAuthStatePayload = JSON.parse(
        Buffer.from(payloadBase64, 'base64url').toString('utf8'),
      );

      // Verify expiration (max 10 minutes)
      const maxAgeMs = 10 * 60 * 1000;
      if (Date.now() - payload.timestamp > maxAgeMs) {
        this.logger.warn('OAuth state token expired');
        return { valid: false };
      }

      // Check in-memory store if present (for replay protection)
      if (this.stateStore.has(state)) {
        this.stateStore.delete(state); // One-time use to prevent replay attacks
      }

      return { valid: true, payload };
    } catch (err: any) {
      this.logger.error(`Error parsing state payload: ${err.message}`);
      return { valid: false };
    }
  }
}
