import { LoggerService } from '@nestjs/common';
import { redactDeep } from './redact';
import { scrubText } from './scrub';
import { currentContext } from './tracing';

/**
 * Structured logging. In JSON mode every log call becomes one JSON line on stdout (errors and warnings on stderr) with a fixed set of
 * fields that log aggregators can index: timestamp, level, context, message, and, inside a request, requestId, traceId, spanId and userId.
 * Messages and stack text are scrubbed of e-mail addresses, tokens, passwords and connection strings before they are written.
 *
 * LOG_FORMAT=json|pretty (default: json in production, pretty otherwise). LOG_LEVEL=debug|info|warn|error (default: info in production,
 * debug otherwise). A log call may pass an OBJECT as the message (`logger.log({ event: 'http_request', status: 200 })`); its fields are
 * merged into the line, which is how the access log and other events carry data as fields instead of as text.
 */
type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };
const NEST_LEVEL: Record<string, Level> = { verbose: 'debug', debug: 'debug', log: 'info', warn: 'warn', error: 'error', fatal: 'fatal' };
/** Field names never copied from a logged object (they would collide with the envelope or hold secrets). */
const RESERVED = new Set(['timestamp', 'level', 'context', 'message', 'service', 'stack']);

/**
 * Pretty (human-readable) output is one entry per line, so untrusted text in it must not be able to start another entry or move the cursor.
 * Line breaks (including the Unicode line and paragraph separators) become a visible marker, other control characters (escape sequences
 * included) are dropped. JSON output does not need this: JSON.stringify escapes all of them.
 */
const LINE_BREAKS = new RegExp('[' + '\r' + '\n' + String.fromCharCode(0x2028, 0x2029, 0x85) + ']+', 'g');
const CONTROLS = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(8) + String.fromCharCode(0x0b) + '-' + String.fromCharCode(0x1f) + String.fromCharCode(0x7f) + ']', 'g');
const oneLine = (v: string): string => v.replace(LINE_BREAKS, ' | ').replace(CONTROLS, '');
/** A stack trace may span lines (the code produced it) but its first line carries the error message, which can be untrusted: every continuation line is indented so none can pass for a log entry. */
const indentedStack = (v: string): string => v.split('\n').map((l, i) => (i === 0 ? oneLine(l) : '    ' + oneLine(l).trimStart())).join('\n');

export interface IStructuredLoggerOptions {
  format?: 'json' | 'pretty';
  level?: Level;
  service?: string;
  /** Where lines go; defaults to stdout / stderr. Replaceable in tests. */
  sink?: (line: string, level: Level) => void;
}

export class StructuredLogger implements LoggerService {
  private readonly format: 'json' | 'pretty';
  private readonly min: number;
  private readonly service: string;
  private readonly sink: (line: string, level: Level) => void;

  constructor(opts: IStructuredLoggerOptions = {}) {
    const prod = process.env.NODE_ENV === 'production';
    const fmt = (opts.format ?? process.env.LOG_FORMAT ?? (prod ? 'json' : 'pretty')).toString().toLowerCase();
    this.format = fmt === 'json' ? 'json' : 'pretty';
    const lvl = String(opts.level ?? process.env.LOG_LEVEL ?? (prod ? 'info' : 'debug')).toLowerCase();
    this.min = ORDER[(lvl in ORDER ? lvl : 'info') as Level];
    this.service = opts.service ?? process.env.OTEL_SERVICE_NAME ?? 'orion-api';
    this.sink = opts.sink ?? ((line, level) => (ORDER[level] >= ORDER.warn ? process.stderr : process.stdout).write(`${line}\n`));
  }

  log(message: unknown, ...p: unknown[]) {
    this.write('log', message, p);
  }
  error(message: unknown, ...p: unknown[]) {
    this.write('error', message, p);
  }
  warn(message: unknown, ...p: unknown[]) {
    this.write('warn', message, p);
  }
  debug(message: unknown, ...p: unknown[]) {
    this.write('debug', message, p);
  }
  verbose(message: unknown, ...p: unknown[]) {
    this.write('verbose', message, p);
  }
  fatal(message: unknown, ...p: unknown[]) {
    this.write('fatal', message, p);
  }

  private write(nestLevel: string, message: unknown, params: unknown[]) {
    const level = NEST_LEVEL[nestLevel] ?? 'info';
    if (ORDER[level] < this.min) return;

    // Nest appends the logger's context as the LAST string parameter; an error call may carry a stack just before it
    const rest = [...params];
    const context = rest.length && typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    let stack = typeof rest[0] === 'string' && /\n\s+at /.test(rest[0]) ? (rest[0] as string) : undefined;

    let text: string;
    let fields: Record<string, unknown> = {};
    if (message instanceof Error) {
      text = message.message;
      stack = stack ?? message.stack;
    } else if (message && typeof message === 'object') {
      const { message: m, ...others } = message as Record<string, unknown>;
      text = typeof m === 'string' ? m : String((others as any).event ?? '');
      fields = others;
    } else text = String(message);

    const t = currentContext();
    const rec: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      ...(context ? { context } : {}),
      message: scrubText(text, 4000),
      ...(t ? { requestId: t.requestId, traceId: t.traceId, spanId: t.spanId, ...(t.userId ? { userId: t.userId } : {}) } : {}),
    };
    // key-based redaction applies to the TOP level of the object too (a field called password or token was previously only text-scrubbed)
    fields = redactDeep(fields) as Record<string, unknown>;
    for (const [k, v] of Object.entries(fields)) {
      if (RESERVED.has(k) || v === undefined) continue;
      // strings are scrubbed; nested objects and arrays are walked and redacted by key and value (a secret inside a field object used to pass untouched)
      rec[k] = typeof v === 'string' ? scrubText(v, 500) : typeof v === 'object' && v !== null ? redactDeep(v) : v;
    }
    if (stack) rec.stack = scrubText(stack.split('\n').slice(0, 12).join('\n'), 3000);

    if (this.format === 'json') {
      this.sink(JSON.stringify(rec), level);
    } else {
      const ev = oneLine(String(rec.event === 'http_request' ? `${rec.method} ${rec.route ?? rec.path} ${rec.status} ${rec.durationMs}ms` : rec.message));
      const ids = rec.requestId ? ` [${oneLine(String(rec.requestId)).slice(0, 8)}${rec.traceId ? `/${oneLine(String(rec.traceId)).slice(0, 8)}` : ''}]` : '';
      this.sink(`${rec.timestamp} ${level.toUpperCase().padEnd(5)} [${oneLine(context ?? '-')}]${ids} ${ev}${rec.stack ? `\n${indentedStack(String(rec.stack))}` : ''}`, level);
    }
  }
}
