/**
 * Whether a request is a genuine local development request (Phase 14).
 *
 * Cookies are marked Secure unless the request is local. The decision used to be `host.includes('localhost')` on the request's Host header,
 * so a host such as `localhost.attacker.example`, or any value a proxy let through, switched the Secure flag off and let the session cookie
 * travel over plain HTTP. Now:
 *  - in production nothing is local, whatever the Host header says;
 *  - elsewhere only an exact loopback host name counts (localhost, 127.0.0.1, ::1 or a *.localhost name), with any port.
 */
export function isLocalRequestHost(hostHeader: string | null | undefined, env: { NODE_ENV?: string } = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  const first = String(hostHeader ?? '').split(',')[0].trim().toLowerCase();
  if (!first) return false;
  const host = first.startsWith('[') ? first.slice(0, first.indexOf(']') + 1) : first.split(':')[0];
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
}
