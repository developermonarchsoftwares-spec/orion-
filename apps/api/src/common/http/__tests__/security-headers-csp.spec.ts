import { createHash } from 'crypto';
import { API_CSP, SWAGGER_CSP, apiHelmetOptions, apiSecurityHeaders, htmlPageCsp } from '../security-headers';
import { DASHBOARD_HTML } from '../../../modules/monitoring/dashboard.html';
import { BillingService } from '../../../modules/payment/billing.service';
import { fixedOtpAllowed } from '../../../auth/admin-auth.controller';

const run = (path: string, env: Record<string, string | undefined>) => {
  const before = { ...process.env };
  Object.assign(process.env, env);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
  try {
    const set: Record<string, string> = {};
    apiSecurityHeaders({ path, headers: {} } as any, { setHeader: (k: string, v: string) => (set[k] = v), getHeader: (k: string) => set[k] } as any, () => undefined);
    return set;
  } finally {
    process.env = before;
  }
};

describe('API Content-Security-Policy (Phase 14)', () => {
  it('JSON responses may load, run and embed nothing: no script from anywhere, no inline script, no framing', () => {
    const csp = run('/api/v1/user/profile', { NODE_ENV: 'production' })['Content-Security-Policy'];
    expect(csp).toBe(API_CSP);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https:|\*/);
  });

  it('the API explorer gets its own looser policy outside production only, and still cannot be framed', () => {
    expect(run('/docs', { NODE_ENV: 'development' })['Content-Security-Policy']).toBe(SWAGGER_CSP);
    expect(run('/docs-json', { NODE_ENV: 'development' })['Content-Security-Policy']).toBe(SWAGGER_CSP);
    expect(SWAGGER_CSP).toContain("frame-ancestors 'none'");
    expect(run('/docs', { NODE_ENV: 'production', SWAGGER_ENABLED: undefined })['Content-Security-Policy']).toBe(API_CSP);
    expect(run('/docs', { NODE_ENV: 'production', SWAGGER_ENABLED: 'true' })['Content-Security-Policy']).toBe(SWAGGER_CSP);
    // a path that merely starts with the letters is not the explorer
    expect(run('/docsearch', { NODE_ENV: 'development' })['Content-Security-Policy']).toBe(API_CSP);
  });

  it('the monitoring dashboard runs its one inline script by hash and loads nothing external', () => {
    const csp = htmlPageCsp(DASHBOARD_HTML);
    const body = DASHBOARD_HTML.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)![1];
    expect(csp).toContain(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline|https:|\*/);
    // editing the script changes the hash: injected or modified script is not allowed
    expect(htmlPageCsp(DASHBOARD_HTML.replace('<script>', '<script>alert(1);'))).not.toBe(csp);
    expect(DASHBOARD_HTML).not.toMatch(/<script[^>]+src=|<link[^>]+href=|@import|https?:\/\//i);
  });

  it('a page with no script gets script-src none', () => {
    expect(htmlPageCsp('<html><body><p>x</p></body></html>')).toContain("script-src 'none'");
  });

  it('the invoice view contains no script, so its policy runs none', () => {
    const html = (BillingService.prototype as any).renderInvoiceHtml.call({}, {
      invoiceNumber: 'INV-1', status: 'PAID', currency: 'INR', issuedAt: new Date('2026-10-12T00:00:00Z'), billingName: 'A', billingEmail: 'a@example.com', paymentId: 'pay_test', description: '100 credits', credits: 100, subtotalPaise: 10000, taxBps: 1800, taxPaise: 1800, totalPaise: 11800,
    });
    expect(html).not.toMatch(/<script/i);
    expect(htmlPageCsp(html)).toContain("script-src 'none'");
  });

  it('Helmet no longer sets a second CSP, and HSTS is production-only without includeSubDomains or preload', () => {
    expect(apiHelmetOptions(true).contentSecurityPolicy).toBe(false);
    expect(apiHelmetOptions(false).strictTransportSecurity).toBe(false);
    expect(apiHelmetOptions(true).strictTransportSecurity).toEqual({ maxAge: 31_536_000, includeSubDomains: false, preload: false });
  });
});

describe('test-only authentication shortcuts (Phase 14)', () => {
  const withEnv = (env: Record<string, string>, fn: () => void) => {
    const before = { ...process.env };
    Object.assign(process.env, env);
    try {
      fn();
    } finally {
      process.env = before;
    }
  };
  it('the fixed admin OTP and its preview exist only in a test run on a local database, never in production, development or staging', () => {
    withEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@localhost:5432/orion_test' }, () => expect(fixedOtpAllowed()).toBe(false));
    withEnv({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://u:p@localhost:5432/orion_test' }, () => expect(fixedOtpAllowed()).toBe(false));
    withEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@db.example.com:5432/orion' }, () => expect(fixedOtpAllowed()).toBe(false));
    withEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/orion_test' }, () => expect(fixedOtpAllowed()).toBe(true));
  });
});
