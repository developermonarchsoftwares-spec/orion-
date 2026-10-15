import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { BusinessException } from '../../common/errors/business.exception';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BillingService } from '../payment/billing.service';
import { IParsedCidr, ipInCidr, normalizeIp, parseCidr, parseIp } from './cidr.util';
import { trafficConfig } from './traffic.config';

export type BlockSubject = 'IP' | 'USER' | 'ACCOUNT';

export interface IBlockInfo {
  id: string;
  subjectType: BlockSubject;
  subject: string;
  reason: string;
  expiresAt: Date;
}

interface ICachedRule {
  id: string;
  parsed: IParsedCidr;
  action: 'DENY' | 'ALLOW';
  scope: 'GLOBAL' | 'ADMIN';
}

/** How long a cached copy of the shared state (rules, blocks) may be before it is re-read. Changes made on this instance apply at once. */
const STATE_TTL_MS = 5_000;
const OVERRIDE_TTL_MS = 30_000;
const TIER_TTL_MS = 60_000;

export interface IRequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * The shared, database-backed part of traffic control: IP rules, temporary blocks (manual and automatic), per-user limit overrides, and
 * the strike engine that turns repeated misbehaviour into an escalating automatic block. Rules and blocks are cached in memory and
 * re-read every few seconds, so a change made on one API instance reaches the others within seconds without a query per request.
 */
@Injectable()
export class TrafficStateService {
  private readonly logger = new Logger(TrafficStateService.name);
  private rules: ICachedRule[] = [];
  private blocks = new Map<string, IBlockInfo>();
  private loadedAt = 0;
  private loading?: Promise<void>;
  private readonly overrides = new Map<string, { perMinute: number | null; perDay: number | null; at: number }>();
  private readonly tiers = new Map<string, { tier: string; at: number }>();
  private readonly strikes = new Map<string, { points: number; start: number }>();

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly audit?: AuditLogService,
    @Optional() private readonly billing?: BillingService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------------------------------------------------

  /** Re-reads rules and blocks when the copy is stale. Safe to call on every request. */
  async ensureFresh(): Promise<void> {
    if (Date.now() - this.loadedAt < STATE_TTL_MS) return;
    return this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const now = new Date();
        const [rules, blocks] = await Promise.all([
          this.db.select().from(schema.ipRules).where(or(isNull(schema.ipRules.expiresAt), gt(schema.ipRules.expiresAt, now))),
          this.db.select().from(schema.trafficBlocks).where(and(gt(schema.trafficBlocks.expiresAt, now), isNull(schema.trafficBlocks.releasedAt))),
        ]);
        this.rules = rules.flatMap((r) => {
          const parsed = parseCidr(r.cidr);
          return parsed ? [{ id: r.id, parsed, action: r.action as 'DENY' | 'ALLOW', scope: r.scope as 'GLOBAL' | 'ADMIN' }] : [];
        });
        this.blocks = new Map(blocks.map((b) => [`${b.subjectType}:${b.subject}`, { id: b.id, subjectType: b.subjectType as BlockSubject, subject: b.subject, reason: b.reason, expiresAt: b.expiresAt }]));
        this.loadedAt = Date.now();
      } catch (err) {
        // never take the API down because the state could not be read: keep what we had and try again soon
        this.logger.error(`Traffic state refresh failed: ${(err as Error).message}`);
        this.loadedAt = Date.now() - STATE_TTL_MS + 1000;
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Lookups used on every request (memory only)
  // ---------------------------------------------------------------------------------------------------------------

  /** DENY always wins over ALLOW. */
  ipVerdict(rawIp: string): { denied: boolean; trusted: boolean } {
    const ip = parseIp(rawIp);
    const matches = this.rules.filter((r) => r.scope === 'GLOBAL' && ipInCidr(ip, r.parsed));
    return { denied: matches.some((r) => r.action === 'DENY'), trusted: matches.some((r) => r.action === 'ALLOW') };
  }

  /** The admin routes are restricted only while at least one ADMIN-scope ALLOW rule exists. */
  adminIpAllowed(rawIp: string): boolean {
    const admin = this.rules.filter((r) => r.scope === 'ADMIN' && r.action === 'ALLOW');
    if (!admin.length) return true;
    const ip = parseIp(rawIp);
    return admin.some((r) => ipInCidr(ip, r.parsed));
  }

  activeBlock(type: BlockSubject, subject: string): IBlockInfo | null {
    const b = this.blocks.get(`${type}:${subject}`);
    if (!b) return null;
    if (b.expiresAt.getTime() <= Date.now()) {
      this.blocks.delete(`${type}:${subject}`);
      return null;
    }
    return b;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Per-user plan and override (small caches, one query when cold)
  // ---------------------------------------------------------------------------------------------------------------

  async tierOf(userId: string): Promise<string> {
    const hit = this.tiers.get(userId);
    if (hit && Date.now() - hit.at < TIER_TTL_MS) return hit.tier;
    let tier = 'free';
    try {
      tier = (await this.billing?.getSubscription(userId))?.tier ?? 'free';
    } catch {
      /* a billing hiccup must not block a request: treat as the free tier */
    }
    this.tiers.set(userId, { tier, at: Date.now() });
    if (this.tiers.size > 20_000) this.tiers.clear();
    return tier;
  }

  async overrideOf(userId: string): Promise<{ perMinute: number | null; perDay: number | null }> {
    const hit = this.overrides.get(userId);
    if (hit && Date.now() - hit.at < OVERRIDE_TTL_MS) return hit;
    let value = { perMinute: null as number | null, perDay: null as number | null };
    try {
      const [row] = await this.db.select().from(schema.userRateOverrides).where(eq(schema.userRateOverrides.userId, userId)).limit(1);
      if (row) value = { perMinute: row.perMinute, perDay: row.perDay };
    } catch {
      /* fall back to the plan limits */
    }
    this.overrides.set(userId, { ...value, at: Date.now() });
    if (this.overrides.size > 20_000) this.overrides.clear();
    return value;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Strikes -> automatic, escalating blocks
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Adds `points` to a subject's recent misbehaviour. At the threshold within the window the subject is blocked, for 5 minutes the first
   * time, then 30 minutes, 2 hours and 24 hours for each further offence within 24 hours. Returns the block when one was just placed.
   */
  async strike(type: BlockSubject, subject: string, points: number, reason: string): Promise<IBlockInfo | null> {
    const cfg = trafficConfig();
    const key = `${type}:${subject}`;
    const now = Date.now();
    let s = this.strikes.get(key);
    if (!s || now - s.start > cfg.abuse.strikeWindowMs) s = { points: 0, start: now };
    s.points += points;
    this.strikes.set(key, s);
    if (this.strikes.size > 50_000) this.pruneStrikes(now, cfg.abuse.strikeWindowMs);
    if (s.points < cfg.abuse.strikeThreshold) return null;
    this.strikes.delete(key);
    if (this.activeBlock(type, subject)) return null;

    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.trafficBlocks)
      .where(and(eq(schema.trafficBlocks.subjectType, type), eq(schema.trafficBlocks.subject, subject), eq(schema.trafficBlocks.source, 'AUTO'), gt(schema.trafficBlocks.createdAt, new Date(now - 86_400_000))));
    const step = Math.min(Number(n), cfg.abuse.blockMinutes.length - 1);
    return this.createBlock({ type, subject, reason, minutes: cfg.abuse.blockMinutes[step], source: 'AUTO' });
  }

  private pruneStrikes(now: number, windowMs: number) {
    for (const [k, v] of this.strikes) if (now - v.start > windowMs) this.strikes.delete(k);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Blocks
  // ---------------------------------------------------------------------------------------------------------------

  async createBlock(input: { type: BlockSubject; subject: string; reason: string; minutes: number; source: 'AUTO' | 'ADMIN'; adminId?: string; ctx?: IRequestContext }): Promise<IBlockInfo> {
    const expiresAt = new Date(Date.now() + input.minutes * 60_000);
    const [row] = await this.db
      .insert(schema.trafficBlocks)
      .values({ subjectType: input.type, subject: input.subject, reason: input.reason.slice(0, 200), source: input.source, createdBy: input.adminId ?? null, expiresAt })
      .returning();
    const info: IBlockInfo = { id: row.id, subjectType: input.type, subject: input.subject, reason: row.reason, expiresAt };
    this.blocks.set(`${input.type}:${input.subject}`, info);
    await this.audit?.record({
      userId: input.adminId ?? null,
      action: input.source === 'AUTO' ? 'TRAFFIC_AUTO_BLOCK' : 'TRAFFIC_BLOCK_CREATED',
      entityType: 'TRAFFIC_BLOCK',
      entityId: row.id,
      newValues: { subjectType: input.type, subject: input.type === 'ACCOUNT' ? '(hashed account)' : input.subject, minutes: input.minutes, reason: row.reason },
      ipAddress: input.ctx?.ip,
      userAgent: input.ctx?.userAgent,
    });
    this.logger.warn(`Blocked ${input.type} ${input.type === 'ACCOUNT' ? '(account)' : input.subject} for ${input.minutes} min (${input.source}): ${row.reason}`);
    return info;
  }

  async releaseBlock(id: string, adminId: string, ctx?: IRequestContext) {
    const rows = /^[0-9a-f-]{36}$/i.test(id) ? await this.db.update(schema.trafficBlocks).set({ releasedAt: new Date() }).where(and(eq(schema.trafficBlocks.id, id), isNull(schema.trafficBlocks.releasedAt))).returning() : [];
    if (!rows.length) throw new BusinessException('Block not found', 'BLOCK_NOT_FOUND', HttpStatus.NOT_FOUND);
    this.blocks.delete(`${rows[0].subjectType}:${rows[0].subject}`);
    await this.audit?.record({ userId: adminId, action: 'TRAFFIC_BLOCK_RELEASED', entityType: 'TRAFFIC_BLOCK', entityId: id, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { success: true };
  }

  async listBlocks(limit = 100) {
    const rows = await this.db
      .select()
      .from(schema.trafficBlocks)
      .where(and(gt(schema.trafficBlocks.expiresAt, new Date()), isNull(schema.trafficBlocks.releasedAt)))
      .orderBy(desc(schema.trafficBlocks.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
    // account blocks are keyed by a hash: never show it as if it were an address
    return rows.map((b) => ({ id: b.id, subjectType: b.subjectType, subject: b.subjectType === 'ACCOUNT' ? '(login account)' : b.subject, reason: b.reason, source: b.source, createdBy: b.createdBy, expiresAt: b.expiresAt, createdAt: b.createdAt }));
  }

  // ---------------------------------------------------------------------------------------------------------------
  // IP rules (administrators)
  // ---------------------------------------------------------------------------------------------------------------

  async listIpRules() {
    const rows = await this.db.select().from(schema.ipRules).orderBy(desc(schema.ipRules.createdAt)).limit(500);
    const now = Date.now();
    return rows.map((r) => ({ ...r, active: !r.expiresAt || r.expiresAt.getTime() > now }));
  }

  /**
   * Refuses a rule that would lock the administrator out: a DENY that covers the caller's own address, or the FIRST admin-scope ALLOW
   * that does not include it (the admin routes become reachable only from the listed ranges the moment one exists).
   */
  async addIpRule(input: { cidr: string; action: 'DENY' | 'ALLOW'; scope: 'GLOBAL' | 'ADMIN'; reason: string; expiresInHours?: number }, adminId: string, callerIp: string, ctx?: IRequestContext) {
    const parsed = parseCidr(input.cidr);
    if (!parsed) throw new BusinessException('Enter an IP address or a CIDR range such as 203.0.113.0/24', 'INVALID_CIDR', HttpStatus.BAD_REQUEST);
    if (input.scope === 'ADMIN' && input.action === 'DENY') throw new BusinessException('Admin-scope rules are allow-lists: use scope GLOBAL to deny', 'INVALID_RULE', HttpStatus.BAD_REQUEST);
    if (input.action === 'DENY' && parsed.prefix === 0) throw new BusinessException('That range would block everyone', 'INVALID_RULE', HttpStatus.BAD_REQUEST);
    await this.refresh();
    const caller = parseIp(callerIp);
    if (input.action === 'DENY' && ipInCidr(caller, parsed)) {
      throw new BusinessException('That rule would block your own address', 'WOULD_LOCK_OUT_YOU', HttpStatus.CONFLICT);
    }
    if (input.scope === 'ADMIN' && input.action === 'ALLOW' && !this.rules.some((r) => r.scope === 'ADMIN' && r.action === 'ALLOW') && !ipInCidr(caller, parsed)) {
      throw new BusinessException('The first admin allow-list entry must include your own address, or you would lose access to the admin routes', 'WOULD_LOCK_OUT_YOU', HttpStatus.CONFLICT);
    }
    const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 3_600_000) : null;
    const [row] = await this.db.insert(schema.ipRules).values({ cidr: parsed.text, action: input.action, scope: input.scope, reason: input.reason.trim(), createdBy: adminId, expiresAt }).returning();
    await this.refresh();
    await this.audit?.record({ userId: adminId, action: 'TRAFFIC_IP_RULE_CREATED', entityType: 'IP_RULE', entityId: row.id, newValues: { cidr: row.cidr, action: row.action, scope: row.scope, reason: row.reason, expiresAt }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return row;
  }

  async removeIpRule(id: string, adminId: string, ctx?: IRequestContext) {
    const rows = /^[0-9a-f-]{36}$/i.test(id) ? await this.db.delete(schema.ipRules).where(eq(schema.ipRules.id, id)).returning() : [];
    if (!rows.length) throw new BusinessException('Rule not found', 'IP_RULE_NOT_FOUND', HttpStatus.NOT_FOUND);
    await this.refresh();
    await this.audit?.record({ userId: adminId, action: 'TRAFFIC_IP_RULE_DELETED', entityType: 'IP_RULE', entityId: id, oldValues: { cidr: rows[0].cidr, action: rows[0].action, scope: rows[0].scope }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { success: true };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Per-user overrides (administrators)
  // ---------------------------------------------------------------------------------------------------------------

  async setOverride(userId: string, input: { perMinute?: number | null; perDay?: number | null; note?: string }, adminId: string, ctx?: IRequestContext) {
    const [user] = /^[0-9a-f-]{36}$/i.test(userId) ? await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1) : [];
    if (!user) throw new BusinessException('User not found', 'USER_NOT_FOUND', HttpStatus.NOT_FOUND);
    const values = { perMinute: input.perMinute ?? null, perDay: input.perDay ?? null, note: input.note?.slice(0, 200) ?? null, setBy: adminId, updatedAt: new Date() };
    await this.db.insert(schema.userRateOverrides).values({ userId, ...values }).onConflictDoUpdate({ target: schema.userRateOverrides.userId, set: values });
    this.overrides.delete(userId);
    await this.audit?.record({ userId: adminId, action: 'TRAFFIC_USER_LIMIT_SET', entityType: 'USER', entityId: userId, newValues: { perMinute: values.perMinute, perDay: values.perDay, note: values.note }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { userId, perMinute: values.perMinute, perDay: values.perDay, note: values.note };
  }

  async clearOverride(userId: string, adminId: string, ctx?: IRequestContext) {
    const rows = /^[0-9a-f-]{36}$/i.test(userId) ? await this.db.delete(schema.userRateOverrides).where(eq(schema.userRateOverrides.userId, userId)).returning() : [];
    this.overrides.delete(userId);
    if (rows.length) await this.audit?.record({ userId: adminId, action: 'TRAFFIC_USER_LIMIT_CLEARED', entityType: 'USER', entityId: userId, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return { success: true, hadOverride: rows.length > 0 };
  }

  async getOverride(userId: string) {
    const [row] = /^[0-9a-f-]{36}$/i.test(userId) ? await this.db.select().from(schema.userRateOverrides).where(eq(schema.userRateOverrides.userId, userId)).limit(1) : [];
    return row ?? null;
  }

  /** Test and operator hook: forget cached tiers / overrides. */
  clearCaches() {
    this.tiers.clear();
    this.overrides.clear();
    this.strikes.clear();
  }

  /** `normalizeIp` re-exported so callers use the same form the rules are matched in. */
  clientKey(rawIp: string | undefined): string {
    return normalizeIp(rawIp) || 'unknown';
  }
}
