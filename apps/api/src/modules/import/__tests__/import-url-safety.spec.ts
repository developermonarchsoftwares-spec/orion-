import { ValidationSeverity } from '@orion/shared';
import { NormalizationService } from '../services/normalization.service';
import { ValidationService } from '../services/validation.service';

/**
 * Imported website and LinkedIn values are untrusted text. They are normalised to a safe public http(s) address or left out, and an
 * omitted value is reported as a validation warning; the record itself still goes through the normal review and publish steps.
 */
describe('import: untrusted URLs in CSV rows', () => {
  const normalizer = new NormalizationService();
  const validator = new ValidationService();
  const row = (extra: Record<string, unknown>) => ({
    business_name: 'Acme Industries Pvt Ltd',
    name: 'Acme Industries Pvt Ltd',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411001',
    ...extra,
  });
  const presences = (extra: Record<string, unknown>) => normalizer.normalizeRecord(row(extra) as any).digitalPresences;

  it('keeps a normal website and LinkedIn page, in the form people typed them', () => {
    const p = presences({ website: 'https://www.acme.in', linkedin: 'https://www.linkedin.com/company/acme' });
    expect(p).toEqual([
      { platform: 'WEBSITE', url: 'https://www.acme.in', domain: 'acme.in' },
      { platform: 'LINKEDIN', url: 'https://www.linkedin.com/company/acme' },
    ]);
    expect(presences({ website: 'acme.in' })[0]).toMatchObject({ url: 'https://acme.in', domain: 'acme.in' });
    expect(presences({ websiteUrl: 'http://acme.in/products' })[0]).toMatchObject({ url: 'http://acme.in/products' });
  });

  it.each([
    ['javascript scheme', 'javascript:alert(document.cookie)'],
    ['data URL', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['file URL', 'file:///etc/passwd'],
    ['credentials', 'https://admin:hunter2@acme.in'],
    ['loopback', 'http://127.0.0.1:8080/admin'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['internal name', 'https://intranet.corp'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['whitespace inside', 'https://acme.in/a b'],
    ['too long', `https://acme.in/${'x'.repeat(600)}`],
  ])('does not store a website that is a %s, and reports it', (_label, value) => {
    const record = normalizer.normalizeRecord(row({ website: value }) as any);
    expect(record.digitalPresences.filter((d) => d.platform === 'WEBSITE')).toEqual([]);
    expect(record.rejectedUrls).toEqual([{ field: 'website', reason: expect.any(String) }]);
    const result = validator.validateRecord(record);
    const warning = result.logs.find((l) => l.ruleName === 'UNSAFE_OR_INVALID_URL');
    expect(warning).toMatchObject({ field: 'website', severity: ValidationSeverity.WARNING, passed: false });
    expect(result.isValid).toBe(true); // a bad link is a warning: the record keeps its normal path and is still reviewed before publication
    expect(JSON.stringify(result.logs)).not.toContain('hunter2'); // the rejected value itself is not echoed into the log
  });

  it('only a LinkedIn address is accepted in the LinkedIn field', () => {
    for (const value of ['https://evil.example/in/someone', 'javascript:alert(1)', 'https://linkedin.com.evil.example/in/x', 'company/acme']) {
      const record = normalizer.normalizeRecord(row({ linkedin: value }) as any);
      expect(record.digitalPresences.filter((d) => d.platform === 'LINKEDIN')).toEqual([]);
      expect(record.rejectedUrls?.[0]).toMatchObject({ field: 'linkedin' });
    }
  });

  it('a row with no URLs, or only valid ones, produces no rejection and no warning', () => {
    for (const extra of [{}, { website: 'https://acme.in' }]) {
      const record = normalizer.normalizeRecord(row(extra) as any);
      expect(record.rejectedUrls).toBeUndefined();
      expect(validator.validateRecord(record).logs.some((l) => l.ruleName === 'UNSAFE_OR_INVALID_URL')).toBe(false);
    }
  });

  it('a hostile value in one field does not disturb the rest of the record', () => {
    const record = normalizer.normalizeRecord(row({ website: 'javascript:alert(1)', gstin: '27AAACT2727Q1ZW' }) as any);
    expect(record.name).toBe('Acme Industries Private Limited'); // the normal name normalisation still ran
    expect(record.identifiers.some((i) => i.type === 'GSTIN')).toBe(true);
    expect(record.locations[0]).toMatchObject({ city: 'Pune' });
  });
});
