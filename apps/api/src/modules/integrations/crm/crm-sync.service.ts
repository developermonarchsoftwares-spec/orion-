import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { BusinessException } from '../../../common/errors/business.exception';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { DrizzleDb } from '../../../database/database.provider';
import * as schema from '../../../database/schema';
import { IntegrationsService } from '../integrations.service';
import { CONTACT_TO_COMPANY_ASSOCIATION_TYPE_ID, HUBSPOT_PATHS, HubSpotClient, IHubSpotResponse } from './hubspot.client';
import { presentCompanyContact } from '../../../common/privacy/data-classification';

/** Most records one sync call pushes (HubSpot rate limits are per account; a big book is synced over several calls). */
export const MAX_SYNC_PER_CALL = 200;
const MAX_LOCAL_ENTITIES = 5000;
const MAX_REMOTE_CHECKS = 100;

interface ILocalEntity {
  type: 'COMPANY' | 'CONTACT';
  localId: string;
  businessId: string;
  props: Record<string, string>;
  hash: string;
}

const hashOf = (props: Record<string, string>, extra = '') => createHash('sha256').update(JSON.stringify(Object.keys(props).sort().map((k) => [k, props[k]])) + extra).digest('hex');
const clean = (o: Record<string, string | null | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '').map(([k, v]) => [k, String(v).trim()]));
const errText = (r: IHubSpotResponse) => `HTTP ${r.status}${r.json?.message ? `: ${String(r.json.message).slice(0, 200)}` : ''}`;

/**
 * Pushes a customer's UNLOCKED leads (companies, and their contacts) to HubSpot, remembers what was pushed (a hash per record), and
 * checks later that the two sides still agree. Only data the customer has unlocked is ever sent. Re-running a sync sends only records that
 * are new, changed or failed last time.
 */
@Injectable()
export class CrmSyncService {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly integrations: IntegrationsService,
    private readonly hubspot: HubSpotClient,
    @Optional() private readonly audit?: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------------
  // What should be in the CRM
  // ---------------------------------------------------------------------------------------------------------------

  async localEntities(userId: string): Promise<{ list: ILocalEntity[]; truncated: boolean }> {
    const unlocks = await this.db.select({ businessId: schema.leadUnlocks.businessId }).from(schema.leadUnlocks).where(eq(schema.leadUnlocks.userId, userId)).limit(MAX_LOCAL_ENTITIES);
    const ids = unlocks.map((u) => u.businessId);
    if (!ids.length) return { list: [], truncated: false };
    const [businesses, locations, contacts] = await Promise.all([
      this.db.select().from(schema.businesses).where(inArray(schema.businesses.id, ids)),
      this.db.select().from(schema.businessLocations).where(and(inArray(schema.businessLocations.businessId, ids), eq(schema.businessLocations.isPrimary, true))),
      this.db.select().from(schema.businessContacts).where(inArray(schema.businessContacts.businessId, ids)),
    ]);
    const locOf = new Map(locations.map((l) => [l.businessId, l]));
    const list: ILocalEntity[] = [];
    for (const b of businesses) {
      const l = locOf.get(b.id);
      const props = clean({ name: b.name, description: b.description?.slice(0, 1000), city: l?.city, state: l?.state, zip: l?.pincode, country: l?.country, founded_year: b.foundingYear ? String(b.foundingYear) : null });
      list.push({ type: 'COMPANY', localId: b.id, businessId: b.id, props, hash: hashOf(props) });
    }
    for (const c of contacts) {
      const [first, ...rest] = c.fullName.trim().split(/\s+/);
      // same disclosure policy as the screens and exports (Phase 10)
      const shown = presentCompanyContact(c, { unlocked: true });
      const props = clean({ email: shown.email, firstname: first, lastname: rest.join(' '), phone: shown.phone, jobtitle: c.title });
      list.push({ type: 'CONTACT', localId: c.id, businessId: c.businessId, props, hash: hashOf(props, c.businessId) });
    }
    return { list, truncated: unlocks.length === MAX_LOCAL_ENTITIES };
  }

  private async crmOf(userId: string, id: string) {
    const integ = await this.integrations.getOwned(userId, id);
    if (integ.type !== 'HUBSPOT') throw new BusinessException('This is not a CRM integration', 'NOT_A_CRM', HttpStatus.BAD_REQUEST);
    return integ;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------------------------------------------

  private async saveRecord(integrationId: string, e: ILocalEntity, patch: { status: 'SYNCED' | 'FAILED'; externalId?: string | null; error?: string | null }) {
    const now = new Date();
    const values = { integrationId, entityType: e.type, localId: e.localId, payloadHash: e.hash, status: patch.status, externalId: patch.externalId ?? null, lastError: patch.error ? patch.error.slice(0, 300) : null, lastSyncedAt: patch.status === 'SYNCED' ? now : null, updatedAt: now };
    await this.db
      .insert(schema.syncRecords)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.syncRecords.integrationId, schema.syncRecords.entityType, schema.syncRecords.localId],
        // a failed attempt keeps the last known external id and last good sync time
        set: patch.status === 'SYNCED' ? { payloadHash: e.hash, status: 'SYNCED', externalId: patch.externalId ?? null, lastError: null, lastSyncedAt: now, updatedAt: now } : { status: 'FAILED', lastError: values.lastError, updatedAt: now },
      });
  }

  async sync(userId: string, id: string, limit = 100, ctx?: { ip?: string | null; userAgent?: string | null }) {
    const integ = await this.crmOf(userId, id);
    if (integ.status !== 'ACTIVE') throw new BusinessException('Turn the integration on before syncing', 'INTEGRATION_NOT_ACTIVE', HttpStatus.CONFLICT);
    const token = this.integrations.credentialOf(integ);
    if (!token) throw new BusinessException('No access token is stored for this integration', 'CREDENTIAL_REQUIRED', HttpStatus.CONFLICT);

    const { list } = await this.localEntities(userId);
    const existing = await this.db.select().from(schema.syncRecords).where(eq(schema.syncRecords.integrationId, id));
    const byKey = new Map(existing.map((r) => [`${r.entityType}:${r.localId}`, r]));
    const needs = (e: ILocalEntity) => {
      const r = byKey.get(`${e.type}:${e.localId}`);
      return !r || r.status === 'FAILED' || r.payloadHash !== e.hash;
    };
    const cap = Math.min(Math.max(Math.floor(limit) || 100, 1), MAX_SYNC_PER_CALL);
    // companies first, so a contact can be attached to the company just created
    const todoAll = [...list.filter((e) => e.type === 'COMPANY' && needs(e)), ...list.filter((e) => e.type === 'CONTACT' && needs(e))];
    const todo = todoAll.slice(0, cap);

    const out = { attempted: 0, created: 0, updated: 0, failed: 0, skipped: 0, remaining: 0, rateLimited: false, credentialRejected: false, errors: [] as Array<{ entityType: string; localId: string; error: string }> };
    const companyExt = new Map<string, string>(existing.filter((r) => r.entityType === 'COMPANY' && r.status === 'SYNCED' && r.externalId).map((r) => [r.localId, r.externalId as string]));
    const fail = async (e: ILocalEntity, error: string) => {
      processed++;
      out.failed++;
      if (out.errors.length < 20) out.errors.push({ entityType: e.type, localId: e.localId, error });
      await this.saveRecord(id, e, { status: 'FAILED', error });
    };

    let processed = 0; // records fully handled this call: pushed, failed or skipped
    for (const e of todo) {
      out.attempted++;
      const prior = byKey.get(`${e.type}:${e.localId}`);
      const collection = e.type === 'COMPANY' ? HUBSPOT_PATHS.companies : HUBSPOT_PATHS.contacts;
      let res: IHubSpotResponse;
      try {
        if (e.type === 'CONTACT' && !companyExt.get(e.businessId)) {
          out.skipped++;
          out.attempted--;
          processed++;
          await this.saveRecord(id, e, { status: 'FAILED', error: 'its company is not in the CRM yet' });
          continue;
        }
        if (prior?.externalId) {
          res = await this.hubspot.request(token, 'PATCH', `${collection}/${prior.externalId}`, { properties: e.props });
          if (res.status === 404) res = await this.create(token, e, collection, companyExt); // deleted on the CRM side: create it again
          else if (res.status >= 200 && res.status < 300) {
            await this.saveRecord(id, e, { status: 'SYNCED', externalId: prior.externalId });
            if (e.type === 'COMPANY') companyExt.set(e.localId, prior.externalId);
            out.updated++;
            processed++;
            continue;
          }
        } else {
          res = await this.create(token, e, collection, companyExt);
        }
      } catch (err) {
        await fail(e, `network error: ${String((err as Error).message).slice(0, 150)}`);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        out.credentialRejected = true;
        await fail(e, errText(res));
        break;
      }
      if (res.status === 429) {
        out.rateLimited = true;
        out.attempted--; // this record was not sent: it stays in `remaining`
        break;
      }
      // a contact whose e-mail already exists in the CRM: adopt that record and update it
      if (res.status === 409 && e.type === 'CONTACT') {
        const m = /Existing ID:\s*(\d+)/i.exec(String(res.json?.message ?? ''));
        if (m) {
          const upd = await this.hubspot.request(token, 'PATCH', `${collection}/${m[1]}`, { properties: e.props }).catch(() => null);
          if (upd && upd.status >= 200 && upd.status < 300) {
            await this.hubspot.request(token, 'PUT', HUBSPOT_PATHS.associateDefault(m[1], companyExt.get(e.businessId) as string)).catch(() => null);
            await this.saveRecord(id, e, { status: 'SYNCED', externalId: m[1] });
            out.updated++;
            processed++;
            continue;
          }
        }
      }
      if (res.status >= 200 && res.status < 300 && res.json?.id) {
        const ext = String(res.json.id);
        await this.saveRecord(id, e, { status: 'SYNCED', externalId: ext });
        if (e.type === 'COMPANY') companyExt.set(e.localId, ext);
        out.created++;
        processed++;
      } else await fail(e, errText(res));
    }
    out.remaining = todoAll.length - processed;

    // the run's outcome is the integration's health signal: all failures and nothing synced is a failed run
    const synced = out.created + out.updated;
    if (out.credentialRejected) await this.integrations.recordOutcome(id, false, 'the CRM rejected the access token', 'access token rejected by the CRM');
    else if (out.failed > 0 && synced === 0) await this.integrations.recordOutcome(id, false, out.errors[0]?.error ?? 'sync failed');
    else if (!(out.rateLimited && synced === 0)) await this.integrations.recordOutcome(id, true);
    await this.audit?.record({ userId, action: 'INTEGRATION_SYNCED', entityType: 'INTEGRATION', entityId: id, newValues: { attempted: out.attempted, created: out.created, updated: out.updated, failed: out.failed, remaining: out.remaining, rateLimited: out.rateLimited }, ipAddress: ctx?.ip, userAgent: ctx?.userAgent });
    return out;
  }

  private create(token: string, e: ILocalEntity, collection: string, companyExt: Map<string, string>) {
    const body: any = { properties: e.props };
    if (e.type === 'CONTACT') body.associations = [{ to: { id: Number(companyExt.get(e.businessId)) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: CONTACT_TO_COMPANY_ASSOCIATION_TYPE_ID }] }];
    return this.hubspot.request(token, 'POST', collection, body);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Data synchronisation validation
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Compares what SHOULD be in the CRM (the customer's unlocked leads) with what Orion recorded as pushed, and optionally asks the CRM
   * whether those records still exist and still say the same thing.
   *  - missing: never pushed;  stale: changed since the last push;  failed: the last push failed;
   *  - orphaned: pushed earlier, but no longer an unlocked lead here;
   *  - remoteMissing / remoteMismatch (only with `remote`): deleted on the CRM side, or its name / e-mail differs.
   */
  async validate(userId: string, id: string, opts: { remote?: boolean; remoteLimit?: number } = {}) {
    const integ = await this.crmOf(userId, id);
    const { list, truncated } = await this.localEntities(userId);
    const recs = await this.db.select().from(schema.syncRecords).where(eq(schema.syncRecords.integrationId, id));
    const byKey = new Map(recs.map((r) => [`${r.entityType}:${r.localId}`, r]));
    const localKeys = new Set(list.map((e) => `${e.type}:${e.localId}`));

    const missing: ILocalEntity[] = [];
    const stale: ILocalEntity[] = [];
    const failed: ILocalEntity[] = [];
    let inSync = 0;
    for (const e of list) {
      const r = byKey.get(`${e.type}:${e.localId}`);
      if (!r) missing.push(e);
      else if (r.status === 'FAILED') failed.push(e);
      else if (r.payloadHash !== e.hash) stale.push(e);
      else inSync++;
    }
    const orphaned = recs.filter((r) => !localKeys.has(`${r.entityType}:${r.localId}`));
    const ref = (e: ILocalEntity) => ({ entityType: e.type, localId: e.localId });

    let remote: { checked: number; missing: Array<{ entityType: string; localId: string }>; mismatched: Array<{ entityType: string; localId: string; field: string }>; error?: string } | null = null;
    if (opts.remote) {
      const token = this.integrations.credentialOf(integ);
      remote = { checked: 0, missing: [], mismatched: [] };
      const localBy = new Map(list.map((e) => [`${e.type}:${e.localId}`, e]));
      const sample = recs.filter((r) => r.status === 'SYNCED' && r.externalId && localBy.has(`${r.entityType}:${r.localId}`)).slice(0, Math.min(Math.max(opts.remoteLimit ?? 50, 1), MAX_REMOTE_CHECKS));
      for (const r of sample) {
        const e = localBy.get(`${r.entityType}:${r.localId}`) as ILocalEntity;
        const collection = r.entityType === 'COMPANY' ? HUBSPOT_PATHS.companies : HUBSPOT_PATHS.contacts;
        const field = r.entityType === 'COMPANY' ? 'name' : 'email';
        try {
          const res = await this.hubspot.request(token as string, 'GET', `${collection}/${r.externalId}?properties=${field}`);
          remote.checked++;
          if (res.status === 404) remote.missing.push({ entityType: r.entityType, localId: r.localId });
          else if (res.status === 401 || res.status === 403) {
            remote.error = 'the CRM rejected the access token';
            break;
          } else if (res.status === 429) {
            remote.error = 'the CRM rate limit was reached; check again later';
            break;
          } else if (res.status >= 200 && res.status < 300) {
            const theirs = String(res.json?.properties?.[field] ?? '').trim().toLowerCase();
            const ours = (e.props[field] ?? '').trim().toLowerCase();
            if (ours && theirs !== ours) remote.mismatched.push({ entityType: r.entityType, localId: r.localId, field });
          }
        } catch (err) {
          remote.error = `network error: ${String((err as Error).message).slice(0, 100)}`;
          break;
        }
      }
    }

    const summary = { expected: list.length, inSync, missing: missing.length, stale: stale.length, failed: failed.length, orphaned: orphaned.length, remoteChecked: remote?.checked ?? null, remoteMissing: remote?.missing.length ?? null, remoteMismatch: remote?.mismatched.length ?? null };
    const consistent = !missing.length && !stale.length && !failed.length && !orphaned.length && !(remote?.missing.length) && !(remote?.mismatched.length) && !remote?.error && !truncated;
    const report = {
      kind: 'CRM',
      integrationId: id,
      checkedAt: new Date().toISOString(),
      consistent,
      truncated,
      summary,
      samples: { missing: missing.slice(0, 20).map(ref), stale: stale.slice(0, 20).map(ref), failed: failed.slice(0, 20).map(ref), orphaned: orphaned.slice(0, 20).map((r) => ({ entityType: r.entityType, localId: r.localId })), remoteMissing: remote?.missing.slice(0, 20) ?? [], remoteMismatch: remote?.mismatched.slice(0, 20) ?? [] },
      remoteError: remote?.error ?? null,
      advice: consistent ? 'The CRM matches your unlocked leads.' : 'Run a sync to push missing, changed and failed records. Orphaned records are not deleted from the CRM automatically.',
    };
    await this.db.update(schema.integrations).set({ lastValidation: report, lastValidatedAt: new Date() }).where(eq(schema.integrations.id, id));
    return report;
  }

  /** Connection test: one harmless read with the stored token. */
  async testConnection(userId: string, id: string) {
    const integ = await this.crmOf(userId, id);
    const token = this.integrations.credentialOf(integ);
    if (!token) throw new BusinessException('No access token is stored for this integration', 'CREDENTIAL_REQUIRED', HttpStatus.CONFLICT);
    try {
      const r = await this.hubspot.request(token, 'GET', `${HUBSPOT_PATHS.companies}?limit=1`);
      const ok = r.status >= 200 && r.status < 300;
      return { ok, statusCode: r.status, error: ok ? undefined : errText(r) };
    } catch (err) {
      return { ok: false, error: `network error: ${String((err as Error).message).slice(0, 150)}` };
    }
  }
}
