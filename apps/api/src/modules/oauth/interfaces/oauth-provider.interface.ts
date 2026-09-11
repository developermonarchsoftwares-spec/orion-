export interface IOAuthUserProfile {
  provider: 'GOOGLE' | 'MICROSOFT' | string;
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl?: string;
  isEmailVerified: boolean;
  rawProfile?: Record<string, any>;
}

export interface IOAuthTokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface IOAuthProvider {
  readonly name: string;
  getAuthorizationUrl(state: string, codeChallenge?: string): string;
  exchangeCode(code: string, codeVerifier?: string): Promise<IOAuthTokens>;
  getUserProfile(accessToken: string, idToken?: string): Promise<IOAuthUserProfile>;
}
