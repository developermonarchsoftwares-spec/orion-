import * as dotenv from 'dotenv';
import * as path from 'path';

// Load apps/api/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import * as crypto from 'crypto';

function runDiagnostics() {
  console.log('====================================================');
  console.log('GOOGLE OAUTH DIAGNOSTICS & VERIFICATION');
  console.log('====================================================');

  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
  const callbackUrl = (process.env.GOOGLE_CALLBACK_URL || 'https://orion-api-snowy.vercel.app/api/v1/auth/google/callback').trim().replace(/^["']|["']$/g, '');

  const isClientIdConfigured = Boolean(clientId) && !clientId.includes('your-') && !clientId.includes('demo-');
  const isSecretConfigured = Boolean(clientSecret) && !clientSecret.includes('your-') && !clientSecret.includes('demo-');

  console.log(`Google Client ID configured: ${isClientIdConfigured}${isClientIdConfigured ? ` (length: ${clientId.length}, suffix: ...${clientId.slice(-6)})` : ' [EMPTY OR PLACEHOLDER]'}`);
  console.log(`Google Client Secret configured: ${isSecretConfigured}${isSecretConfigured ? ` (length: ${clientSecret.length})` : ' [EMPTY OR PLACEHOLDER]'}`);
  console.log(`Google Callback URL: ${callbackUrl}`);

  if (!isClientIdConfigured || !isSecretConfigured) {
    console.error('\n[ERROR] Google OAuth credentials are not saved in apps/api/.env.');
    console.error('Please make sure you have saved (Ctrl+S) apps/api/.env with:');
    console.error('  GOOGLE_CLIENT_ID=<your-real-google-client-id>');
    console.error('  GOOGLE_CLIENT_SECRET=<your-real-google-client-secret>');
    console.error('  GOOGLE_CALLBACK_URL=https://orion-api-snowy.vercel.app/api/v1/auth/google/callback');
    process.exit(1);
  }

  // Generate PKCE code_verifier and code_challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  // Generate state token
  const statePayload = {
    provider: 'GOOGLE',
    nonce: crypto.randomBytes(16).toString('hex'),
    codeVerifier,
    timestamp: Date.now(),
  };
  const payloadBase64 = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
  const secret = process.env.JWT_ACCESS_SECRET || 'orion_super_secret_access_jwt_key_2026_change_in_production';
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');
  const state = `${payloadBase64}.${signature}`;

  // Build Authorization URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  console.log('\nGenerated Authorization URL Parameter Inspection:');
  const parsed = new URL(authUrl);
  console.log(`- Base URL: ${parsed.origin}${parsed.pathname}`);
  console.log(`- client_id present: ${Boolean(parsed.searchParams.get('client_id'))}`);
  console.log(`- redirect_uri present: ${parsed.searchParams.get('redirect_uri')}`);
  console.log(`- response_type: ${parsed.searchParams.get('response_type')}`);
  console.log(`- scope: ${parsed.searchParams.get('scope')}`);
  console.log(`- state present: ${Boolean(parsed.searchParams.get('state'))}`);
  console.log(`- code_challenge present: ${Boolean(parsed.searchParams.get('code_challenge'))}`);
  console.log(`- code_challenge_method: ${parsed.searchParams.get('code_challenge_method')}`);
  console.log(`- prompt: ${parsed.searchParams.get('prompt')}`);
  console.log(`- client_secret exposed in URL: ${parsed.searchParams.has('client_secret') ? 'YES (UNSAFE!)' : 'NO (SAFE)'}`);

  console.log('\n====================================================');
  console.log('AUTHORIZATION URL INSPECTION: PASSED');
  console.log('====================================================');
  console.log(`AUTHORIZATION_URL_FOR_BROWSER: ${authUrl}`);
}

runDiagnostics();
