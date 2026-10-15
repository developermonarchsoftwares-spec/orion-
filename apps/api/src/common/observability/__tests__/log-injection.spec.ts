import { StructuredLogger } from '../structured-logger';

/**
 * Phase 24: untrusted text must not be able to forge or split log entries. A log line is the unit an investigator (and a log shipper)
 * trusts, so a value that contains a line break, a carriage return or a JSON object must never become a second entry or change the
 * envelope fields (level, timestamp, service, message).
 */
const make = (format: 'json' | 'pretty') => {
  const lines: Array<{ line: string; level: string }> = [];
  const logger = new StructuredLogger({ format, level: 'debug', service: 'svc', sink: (line, level) => lines.push({ line, level }) });
  return { logger, lines };
};
const FORGED = '{"timestamp":"2000-01-01T00:00:00.000Z","level":"info","message":"Admin login succeeded","userId":"admin"}';
const hostile = `harmless\n${FORGED}\r\n2026-10-12T10:00:00.000Z INFO  [AuthService] Admin login succeeded`;

describe('log entries cannot be forged by untrusted input', () => {
  it('JSON format: a hostile message stays inside one entry, as an escaped string', () => {
    const { logger, lines } = make('json');
    logger.log(hostile, 'Ctx');
    expect(lines).toHaveLength(1);
    expect(lines[0].line).not.toMatch(/[\r\n]/);
    const rec = JSON.parse(lines[0].line);
    expect(rec.level).toBe('info');
    expect(rec.message).toContain('harmless');
    expect(rec.message).toContain('Admin login succeeded'); // present as data, not as an entry
    expect(rec.userId).toBeUndefined();
  });

  it('JSON format: a logged object cannot override the envelope fields', () => {
    const { logger, lines } = make('json');
    logger.log({ message: 'real', level: 'debug', timestamp: '2000-01-01T00:00:00.000Z', service: 'other', context: 'Evil', stack: 'forged\n at x', event: 'e' });
    const rec = JSON.parse(lines[0].line);
    expect(rec).toMatchObject({ level: 'info', service: 'svc', message: 'real' });
    expect(rec.timestamp).not.toBe('2000-01-01T00:00:00.000Z');
    expect(rec.context).toBeUndefined();
    expect(rec.stack).toBeUndefined();
  });

  it('JSON format: hostile text in a field value is escaped and scrubbed too', () => {
    const { logger, lines } = make('json');
    logger.log({ event: 'x', note: hostile, password: 'hunter2hunter2' });
    expect(lines).toHaveLength(1);
    expect(lines[0].line).not.toMatch(/[\r\n]/);
    expect(lines[0].line).not.toContain('hunter2hunter2');
  });

  it('pretty format (the default outside production, selectable with LOG_FORMAT): a hostile message cannot start a second line', () => {
    const { logger, lines } = make('pretty');
    logger.log(hostile, 'Ctx');
    expect(lines).toHaveLength(1);
    expect(lines[0].line).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(lines[0].line).toContain('harmless');
  });

  it('pretty format: a hostile context is held to one line as well, and a real stack trace keeps its line breaks', () => {
    const { logger, lines } = make('pretty');
    logger.log('ok', 'Ctx\nINFO forged');
    expect(lines[0].line).not.toMatch(/\n/);
    const err = new Error('boom');
    logger.error(err, 'Ctx');
    expect(lines[1].line).toMatch(/\n\s+at /); // the trace the code produced is allowed to span lines
  });

  it('control characters other than line breaks are removed from pretty output', () => {
    const { logger, lines } = make('pretty');
    logger.log('a\u0000b\u001b[31mred\u001b[0m\u0007c', 'Ctx');
    expect(lines[0].line).not.toMatch(/[\u0000-\u0008\u000b-\u001f]/);
  });
});
