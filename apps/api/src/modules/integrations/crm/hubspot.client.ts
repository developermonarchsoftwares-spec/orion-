import { Injectable } from '@nestjs/common';
import { performance } from 'perf_hooks';
import { outboundDuration, outboundErrors } from '../../../common/observability/metrics';
import { withSpan } from '../../../common/observability/tracing';

/**
 * HubSpot REST, one place for every path and header so a change at HubSpot is a one-line fix. The host is fixed (api.hubapi.com), so
 * this is not a user-supplied URL. Authentication is a private-app access token sent as a Bearer token.
 *
 * NOT verified against a live HubSpot account: the shapes follow HubSpot's published CRM v3 documentation (create / update / get for
 * companies and contacts, association type 279 for contact -> company). The behaviour for a duplicate e-mail (409 with the existing id in
 * the message) and the v4 "default association" path are from HubSpot's documentation / behaviour as understood and are handled
 * defensively. Try a sync against a HubSpot developer test account before relying on it.
 */
export const HUBSPOT_HOST = 'https://api.hubapi.com';
export const HUBSPOT_PATHS = {
  companies: '/crm/v3/objects/companies',
  contacts: '/crm/v3/objects/contacts',
  /** contact -> company, default label */
  associateDefault: (contactId: string, companyId: string) => `/crm/v4/objects/contact/${contactId}/associations/default/company/${companyId}`,
};
export const CONTACT_TO_COMPANY_ASSOCIATION_TYPE_ID = 279;

export interface IHubSpotResponse {
  status: number;
  json: any;
  retryAfterSeconds?: number;
}

@Injectable()
export class HubSpotClient {
  /** One call. Returns the status and parsed body; throws only on a network failure or timeout. Replaceable in tests. */
  async request(token: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<IHubSpotResponse> {
    const t0 = performance.now();
    return withSpan(
      'http.client',
      { 'http.method': method, 'net.peer.name': 'api.hubapi.com', 'orion.target': 'hubspot' },
      async (span) => {
        try {
          const r = await this.call(token, method, path, body);
          outboundDuration.observe({ target: 'hubspot' }, (performance.now() - t0) / 1000);
          if (r.status >= 500 || r.status === 429) outboundErrors.inc({ target: 'hubspot' });
          if (span) span.attributes['http.status_code'] = r.status;
          return r;
        } catch (err) {
          outboundDuration.observe({ target: 'hubspot' }, (performance.now() - t0) / 1000);
          outboundErrors.inc({ target: 'hubspot' });
          throw err;
        }
      },
      'CLIENT',
    );
  }

  private async call(token: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<IHubSpotResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(`${HUBSPOT_HOST}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
        redirect: 'error',
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = { message: text.slice(0, 200) };
      }
      const ra = Number(res.headers.get('retry-after'));
      return { status: res.status, json, retryAfterSeconds: Number.isFinite(ra) && ra > 0 ? ra : undefined };
    } finally {
      clearTimeout(timer);
    }
  }
}
