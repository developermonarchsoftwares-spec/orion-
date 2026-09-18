import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdminOtpHtml,
  sendAdminOtpEmail,
  getResendSenderAddress,
  isAuthorizedAdminEmail,
} from '../email-service.ts';

describe('Admin Email Domain Authorization (@monarchsoftwares.com)', () => {
  it('isAuthorizedAdminEmail() -> should ALLOW any valid email address on @monarchsoftwares.com', () => {
    assert.equal(isAuthorizedAdminEmail('user@monarchsoftwares.com'), true);
    assert.equal(isAuthorizedAdminEmail('admin@monarchsoftwares.com'), true);
    assert.equal(isAuthorizedAdminEmail('subash@monarchsoftwares.com'), true);
    assert.equal(isAuthorizedAdminEmail('hr@monarchsoftwares.com'), true);
    assert.equal(isAuthorizedAdminEmail('anything@monarchsoftwares.com'), true);
    assert.equal(isAuthorizedAdminEmail('john.doe+ops@monarchsoftwares.com'), true);
  });

  it('isAuthorizedAdminEmail() -> should normalize casing and whitespace', () => {
    assert.equal(isAuthorizedAdminEmail('  Subash@MonarchSoftwares.com  '), true);
    assert.equal(isAuthorizedAdminEmail('ADMIN@MONARCHSOFTWARES.COM'), true);
  });

  it('isAuthorizedAdminEmail() -> should REJECT Gmail, Outlook, Yahoo, and other unauthorized domains', () => {
    assert.equal(isAuthorizedAdminEmail('test@gmail.com'), false);
    assert.equal(isAuthorizedAdminEmail('admin@outlook.com'), false);
    assert.equal(isAuthorizedAdminEmail('user@yahoo.com'), false);
    assert.equal(isAuthorizedAdminEmail('admin@orion.ai'), false);
    assert.equal(isAuthorizedAdminEmail('admin@monarchsoftwares.co'), false);
    assert.equal(isAuthorizedAdminEmail('monarchsoftwares.com@gmail.com'), false);
    assert.equal(isAuthorizedAdminEmail('fake@monarchsoftwares.com.attacker.com'), false);
  });

  it('isAuthorizedAdminEmail() -> should REJECT malformed, missing, or empty inputs', () => {
    assert.equal(isAuthorizedAdminEmail('@monarchsoftwares.com'), false);
    assert.equal(isAuthorizedAdminEmail(''), false);
    assert.equal(isAuthorizedAdminEmail('   '), false);
    assert.equal(isAuthorizedAdminEmail(null as any), false);
    assert.equal(isAuthorizedAdminEmail(undefined as any), false);
    assert.equal(isAuthorizedAdminEmail('monarchsoftwares.com'), false);
    assert.equal(isAuthorizedAdminEmail('a@b@monarchsoftwares.com'), false);
  });
});

describe('Admin Email Service & Resend HTTP Dispatch', () => {
  it('getResendSenderAddress() -> should fallback to security@monarchsoftwares.com when RESEND_FROM_EMAIL is not set', () => {
    const originalFrom = process.env.RESEND_FROM_EMAIL;
    delete process.env.RESEND_FROM_EMAIL;
    try {
      const from = getResendSenderAddress();
      assert.equal(from, 'Monarch Security <security@monarchsoftwares.com>');
    } finally {
      if (originalFrom) process.env.RESEND_FROM_EMAIL = originalFrom;
    }
  });

  it('getResendSenderAddress() -> should format custom RESEND_FROM_EMAIL under monarchsoftwares.com properly', () => {
    const originalFrom = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_FROM_EMAIL = 'security@monarchsoftwares.com';
    try {
      const from = getResendSenderAddress();
      assert.equal(from, 'Monarch Security <security@monarchsoftwares.com>');
    } finally {
      if (originalFrom) process.env.RESEND_FROM_EMAIL = originalFrom;
    }
  });

  it('getAdminOtpHtml() -> should generate branded HTML email with OTP, recipient, and security notices', () => {
    const otp = '948201';
    const email = 'admin@monarchsoftwares.com';
    const html = getAdminOtpHtml(otp, email, 5);

    assert.ok(html.includes(otp), 'HTML must contain the 6-digit OTP passcode');
    assert.ok(html.includes(email), 'HTML must mention the recipient email');
    assert.ok(html.includes('MONARCH SECURITY GATEWAY'), 'HTML must feature Monarch branding');
    assert.ok(html.includes('5 minutes'), 'HTML must specify expiration window');
    assert.ok(html.includes('security@monarchsoftwares.com'), 'HTML must include security contact link');
  });

  it('sendAdminOtpEmail() -> should fail safely without exposing OTP when RESEND_API_KEY is missing', async () => {
    const originalResend = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    try {
      const result = await sendAdminOtpEmail({
        email: 'test-admin@monarchsoftwares.com',
        otp: '123456',
        expiresInMinutes: 5,
      });

      assert.equal(result.success, false);
      assert.ok(result.error?.includes('RESEND_API_KEY'), 'Should explicitly mention RESEND_API_KEY is missing');
    } finally {
      if (originalResend) process.env.RESEND_API_KEY = originalResend;
    }
  });

  it('sendAdminOtpEmail() -> should dispatch via Resend HTTP API using configured RESEND_FROM_EMAIL', async () => {
    const originalResend = process.env.RESEND_API_KEY;
    const originalFrom = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_API_KEY = 're_mock_test_key';
    process.env.RESEND_FROM_EMAIL = 'security@monarchsoftwares.com';

    // Mock global.fetch to intercept Resend API call
    const originalFetch = global.fetch;
    let fetchCalled = false;
    let requestPayload: any = null;
    let authHeader: string | null = null;

    (global as any).fetch = async (url: string, init?: any) => {
      if (url === 'https://api.resend.com/emails') {
        fetchCalled = true;
        authHeader = init.headers?.Authorization || null;
        requestPayload = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'email_msg_test_resend_999' }),
        };
      }
      return originalFetch(url, init);
    };

    try {
      const result = await sendAdminOtpEmail({
        email: 'subash@monarchsoftwares.com',
        otp: '654321',
        expiresInMinutes: 5,
      });

      assert.equal(fetchCalled, true, 'Fetch must be called to Resend API endpoint');
      assert.equal(authHeader, 'Bearer re_mock_test_key', 'Must include Authorization Bearer header');
      assert.equal(result.success, true);
      assert.equal(result.messageId, 'email_msg_test_resend_999');
      assert.equal(requestPayload.from, 'Monarch Security <security@monarchsoftwares.com>');
      assert.deepEqual(requestPayload.to, ['subash@monarchsoftwares.com']);
      assert.ok(requestPayload.subject.includes('654321'));
    } finally {
      global.fetch = originalFetch;
      if (originalResend) {
        process.env.RESEND_API_KEY = originalResend;
      } else {
        delete process.env.RESEND_API_KEY;
      }
      if (originalFrom) {
        process.env.RESEND_FROM_EMAIL = originalFrom;
      } else {
        delete process.env.RESEND_FROM_EMAIL;
      }
    }
  });
});
