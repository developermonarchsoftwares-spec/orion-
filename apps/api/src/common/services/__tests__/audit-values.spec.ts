import { tracer } from '../../observability/tracing';
import { auditValues, withRequestId } from '../audit-values';

describe('auditValues: audit rows written directly into a transaction (Phase 31)', () => {
  it('adds the request correlation id inside a request, and leaves a caller-supplied one alone', () => {
    const ctx: any = { traceId: 't', spanId: 's', sampled: false, requestId: 'req-123' };
    tracer.run(ctx, () => {
      expect(auditValues({ role: 'USER' })).toEqual({ role: 'USER', requestId: 'req-123' });
      expect(auditValues({ requestId: 'other' })).toEqual({ requestId: 'other' });
      expect(auditValues(null)).toEqual({ requestId: 'req-123' });
    });
  });

  it('outside a request nothing is invented: empty input stays empty', () => {
    expect(auditValues(undefined)).toBeNull();
    expect(auditValues({ a: 1 })).toEqual({ a: 1 });
  });

  it('redacts secrets and contact details the same way AuditLogService does', () => {
    const out = JSON.stringify(auditValues({ password: 'P31FakePasswordValue!1', refreshToken: 'eyJfake.eyJpayload.sigfake', email: 'victim.person@example.test', note: 'ok' }));
    expect(out).not.toContain('P31FakePasswordValue');
    expect(out).not.toContain('sigfake');
    expect(out).not.toContain('victim.person@example.test');
    expect(out).toContain('ok');
  });

  it('withRequestId adds only the correlation id: reviewer identity and changed values are kept as written', () => {
    const ctx: any = { traceId: 't', spanId: 's', sampled: false, requestId: 'req-9' };
    tracer.run(ctx, () => {
      expect(withRequestId({ reviewedBy: 'reviewer@orion.test', fullName: 'Arun Kumar' })).toEqual({ reviewedBy: 'reviewer@orion.test', fullName: 'Arun Kumar', requestId: 'req-9' });
    });
    expect(withRequestId({ a: 1 })).toEqual({ a: 1 });
  });
});
