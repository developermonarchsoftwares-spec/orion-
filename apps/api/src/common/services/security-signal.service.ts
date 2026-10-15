import { Injectable, Logger, Optional } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Abuse and anomaly signals (Phase 13).
 *
 * Counts security-relevant refusals per subject (the signed-in account, else the client address) in a sliding window kept IN MEMORY. When a
 * count first reaches its threshold in a window, ONE audit entry (`ABUSE_SIGNAL`) is written, so an investigator can see "this subject crossed
 * this line at this time" without a database row per refused request (which would let an attacker fill the audit table).
 *
 * What it is: a tripwire with configurable thresholds. What it is not: proof of malicious activity (a script with an expired token trips
 * AUTH_FAILURE), a block (it never refuses a request), shared across instances (counters are per process) or persistent (a restart resets them).
 *
 * SECURITY_SIGNAL_WINDOW_SECONDS (default 600, 60..86400) and SECURITY_SIGNAL_THRESHOLD_<KIND> override the defaults below.
 */
export type SignalKind = 'AUTH_FAILURE' | 'AUTHZ_DENIED' | 'UNAUTHENTICATED' | 'RATE_LIMITED' | 'SSRF_REJECTED' | 'EXPORT_REFUSED' | 'UNLOCK_REFUSED' | 'OBJECT_PROBING';

export const SIGNAL_DEFAULT_THRESHOLDS: Readonly<Record<SignalKind, number>> = {
  AUTH_FAILURE: 10,
  AUTHZ_DENIED: 15,
  UNAUTHENTICATED: 60,
  RATE_LIMITED: 30,
  SSRF_REJECTED: 5,
  EXPORT_REFUSED: 3,
  UNLOCK_REFUSED: 20,
  /** "Not found" answers on a path that names an object by id. A request for another customer's object is answered 404 on purpose (it must not confirm that the object exists), so this is the only place such probing is visible. */
  OBJECT_PROBING: 30,
};

interface ICounter {
  count: number;
  windowStart: number;
  alerted: boolean;
}

const MAX_SUBJECTS = 5000;

@Injectable()
export class SecuritySignalService {
  private readonly logger = new Logger(SecuritySignalService.name);
  private readonly counters = new Map<string, ICounter>();

  constructor(@Optional() private readonly audit?: AuditLogService) {}

  windowSeconds(env: NodeJS.ProcessEnv = process.env): number {
    const raw = Math.floor(Number(env.SECURITY_SIGNAL_WINDOW_SECONDS));
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.max(raw, 60), 86_400) : 600;
  }

  threshold(kind: SignalKind, env: NodeJS.ProcessEnv = process.env): number {
    const raw = Math.floor(Number(env[`SECURITY_SIGNAL_THRESHOLD_${kind}`]));
    return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 1_000_000) : SIGNAL_DEFAULT_THRESHOLDS[kind];
  }

  /**
   * Counts one occurrence. Never throws and never blocks the request. Returns true when this call crossed the threshold
   * (the audit entry is written in the background).
   */
  hit(kind: SignalKind, subject: { userId?: string | null; ip?: string | null }, now = Date.now()): boolean {
    try {
      const who = subject.userId ? `user:${subject.userId}` : subject.ip ? `ip:${subject.ip}` : null;
      if (!who) return false;
      const key = `${kind}|${who}`;
      const windowMs = this.windowSeconds() * 1000;
      let c = this.counters.get(key);
      if (!c || now - c.windowStart >= windowMs) {
        if (this.counters.size >= MAX_SUBJECTS) this.prune(now, windowMs);
        c = { count: 0, windowStart: now, alerted: false };
        this.counters.set(key, c);
      }
      c.count++;
      const limit = this.threshold(kind);
      if (c.count >= limit && !c.alerted) {
        c.alerted = true;
        void this.audit
          ?.record({
            userId: subject.userId ?? null,
            action: 'ABUSE_SIGNAL',
            entityType: 'SECURITY_SIGNAL',
            entityId: kind,
            ipAddress: subject.ip ?? null,
            newValues: { kind, count: c.count, threshold: limit, windowSeconds: windowMs / 1000, subjectType: subject.userId ? 'ACCOUNT' : 'ADDRESS', note: 'threshold reached; a prompt to review, not proof of abuse' },
          })
          .catch(() => undefined);
        this.logger.warn(`Security signal ${kind} reached ${c.count} (threshold ${limit}) for ${subject.userId ? 'an account' : 'an address'} within ${windowMs / 1000}s`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private prune(now: number, windowMs: number) {
    for (const [k, v] of this.counters) if (now - v.windowStart >= windowMs) this.counters.delete(k);
    // still full of live windows: drop the oldest quarter rather than grow without bound
    if (this.counters.size >= MAX_SUBJECTS) {
      let i = 0;
      for (const k of this.counters.keys()) {
        this.counters.delete(k);
        if (++i >= MAX_SUBJECTS / 4) break;
      }
    }
  }

  /** Counters now, for tests and the metrics endpoint. */
  size(): number {
    return this.counters.size;
  }
}
