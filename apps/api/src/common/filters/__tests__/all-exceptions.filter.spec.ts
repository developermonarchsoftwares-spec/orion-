import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BusinessException } from '../../errors/business.exception';
import { AllExceptionsFilter, safeErrorText, transientDbCode } from '../all-exceptions.filter';

const SQL_ERROR = new Error('relation "users" does not exist; SELECT * FROM users WHERE email = \'a@b.c\' at /srv/app/dist/db.js:42 password=hunter2');

function run(exception: unknown, url = '/api/v1/discover/search?q=secret%20search&industryId=123') {
  let body: any;
  let status = 0;
  const res: any = { status: (s: number) => ((status = s), res), json: (b: unknown) => (body = b), setHeader: () => res };
  const req: any = { method: 'GET', url, originalUrl: url, headers: { 'x-request-id': 'req-123' } };
  const host: any = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) };
  new AllExceptionsFilter().catch(exception, host);
  return { status, body };
}

describe('AllExceptionsFilter: safe error responses', () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => ((process.env as Record<string, string | undefined>).NODE_ENV = saved));
  const env = (v: string | undefined) => {
    if (v === undefined) delete process.env.NODE_ENV;
    else (process.env as Record<string, string>).NODE_ENV = v;
  };
  const leaks = (b: unknown) => /SELECT|relation|users|hunter2|\/srv\/app|db\.js|a@b\.c|stack/i.test(JSON.stringify(b));

  it.each(['production', 'staging', undefined])('an unexpected error in %s is a generic 500 with nothing from the real error in it', (nodeEnv) => {
    env(nodeEnv as string | undefined);
    const { status, body } = run(SQL_ERROR);
    expect(status).toBe(500);
    expect(leaks(body)).toBe(false);
    expect(body.message).toMatch(/unexpected server error|Internal server error/i);
    expect(body.stack).toBeUndefined();
    expect(body.details).toBeUndefined();
  });

  it('the response carries the request id (to quote to support) but never the query string', () => {
    env('production');
    const { body } = run(SQL_ERROR);
    expect(body.requestId).toBe('req-123');
    expect(body.path).toBe('/api/v1/discover/search');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('industryId');
  });

  it('a business failure that is a 5xx also gets the generic text in production, with its details removed', () => {
    env('production');
    const { status, body } = run(new BusinessException('connection to db.internal:5432 refused', 'DB_DOWN', HttpStatus.INTERNAL_SERVER_ERROR, { host: 'db.internal' }));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('db.internal');
  });

  it('expected client errors keep their useful message and status (nothing is turned into a misleading success)', () => {
    env('production');
    const forbidden = run(new ForbiddenException('Access denied'));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.success).toBe(false);
    const business = run(new BusinessException('Insufficient credits', 'INSUFFICIENT_CREDITS', HttpStatus.PAYMENT_REQUIRED, { required: 1 }));
    expect(business.status).toBe(402);
    expect(business.body.errorCode).toBe('INSUFFICIENT_CREDITS');
    const bad = run(new BadRequestException(['limit must not be greater than 100']));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body.details)).toContain('limit must not be greater than 100');
  });

  it('a rate-limit refusal is a 429 with a stable code and no class name', () => {
    env('production');
    const throttled = new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    const { status, body } = run(throttled);
    expect(status).toBe(429);
    expect(body.errorCode).toBe('RATE_LIMITED');
    expect(body.message).not.toMatch(/Exception/);
    expect(body.message).toMatch(/too many requests/i);
  });

  it('a malformed JSON body gets a plain 400 that does not quote the input or the parser', () => {
    env('production');
    const { status, body } = run(new BadRequestException(`Unexpected token 'n', "not json at all" is not valid JSON`));
    expect(status).toBe(400);
    expect(body.errorCode).toBe('BAD_REQUEST');
    expect(JSON.stringify(body)).not.toMatch(/Unexpected token|not json at all/);
    expect(body.message).toBe('The request body is not valid JSON');
  });

  it('an oversized body (a parser error) is a 413 client error, not a 500', () => {
    env('production');
    const tooLarge = Object.assign(new Error('request entity too large'), { statusCode: 413 });
    const { status, body } = run(tooLarge);
    expect(status).toBe(413);
    expect(body.errorCode).toBe('PAYLOAD_TOO_LARGE');
    expect(body.message).not.toMatch(/entity/);
  });

  it('only an explicit development or test run shows the raw error text', () => {
    env('development');
    expect(run(SQL_ERROR).body.message).toContain('relation "users" does not exist');
    env('test');
    expect(run(SQL_ERROR).body.message).toContain('relation');
  });

  describe('a failed database statement does not put customer data in the log (Phase 27)', () => {
    const FAILED = Object.assign(
      new Error('Failed query: insert into "users" ("email", "password_hash", "first_name") values ($1, $2, $3)\nparams: jane.doe@example.com,$2b$12$abcdefghijklmnopqrstuuMyHashValue,Jane'),
      { cause: Object.assign(new Error('duplicate key value violates unique constraint "users_email_idx"'), { code: '23505', table: 'users', constraint: 'users_email_idx' }) },
    );

    it('safeErrorText keeps the failure kind and drops the SQL and every bound value', () => {
      const text = safeErrorText(FAILED);
      expect(text).toContain('23505');
      expect(text).toContain('users_email_idx');
      expect(text).not.toMatch(/jane|\$2b|params|insert into/i);
    });

    it('other errors are unchanged', () => {
      expect(safeErrorText(new Error('something else'))).toBe('something else');
    });

    it('the log lines carry neither the bound values nor the query string', () => {
      env('production');
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        run(FAILED, '/api/v1/discover/search?q=Jane%20Doe%20private');
        const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(logged).toContain('Unhandled Error');
        expect(logged).not.toMatch(/jane|\$2b|params:|Private|q=/i);
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('transient database conditions are a retryable 503, not a 500 (Phase 29)', () => {
    const dbError = (code: string) => Object.assign(new Error('Failed query: select ... params: secret@example.com'), { cause: Object.assign(new Error('x'), { code }) });

    it.each(['55P03', '57014', '40P01', '40001', '25P03', '57P01'])('%s answers 503 DATABASE_BUSY with Retry-After and no internal text', (code) => {
      env('production');
      const headers: Record<string, string> = {};
      let body: any;
      let status = 0;
      const res: any = { status: (s: number) => ((status = s), res), json: (b: unknown) => (body = b), setHeader: (k: string, v: string) => (headers[k] = v) };
      const req: any = { method: 'POST', url: '/api/v1/unlock/business?x=1', originalUrl: '/api/v1/unlock/business?x=1', headers: {} };
      new AllExceptionsFilter().catch(dbError(code), { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as any);
      expect(status).toBe(503);
      expect(body.errorCode).toBe('DATABASE_BUSY');
      expect(headers['Retry-After']).toBe('2');
      expect(JSON.stringify(body)).not.toMatch(/secret|select|params/i);
    });

    it('other database errors (a constraint, a syntax error, an unknown code) stay a 500', () => {
      expect(transientDbCode(dbError('23505'))).toBeUndefined();
      expect(transientDbCode(dbError('42601'))).toBeUndefined();
      expect(transientDbCode(new Error('plain'))).toBeUndefined();
      env('production');
      expect(run(dbError('23505')).status).toBe(500);
    });
  });

  describe('database unavailable is a 503, not a 500 (Phase 30)', () => {
    it.each([
      ['a closed database', Object.assign(new Error('Failed query: select 1'), { cause: Object.assign(new Error('database "x" is not currently accepting connections'), { code: '55000' }) })],
      ['a reset connection', new Error('Connection terminated unexpectedly')],
      ['a pool that could not connect in time', new Error('timeout exceeded when trying to connect')],
      ['a refused socket', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
      ['a connection-exception class', Object.assign(new Error('x'), { cause: { code: '08006' } })],
      ['too many connections', Object.assign(new Error('x'), { cause: { code: '53300' } })],
    ])('%s', (_name, err) => {
      expect(transientDbCode(err)).toBeDefined();
      env('production');
      const res = run(err);
      expect(res.status).toBe(503);
      expect(res.body.errorCode).toBe('DATABASE_BUSY');
    });

    it('an ordinary failure is still a 500', () => {
      expect(transientDbCode(new Error('Cannot read properties of undefined'))).toBeUndefined();
      env('production');
      expect(run(new Error('Cannot read properties of undefined')).status).toBe(500);
    });
  });
});
