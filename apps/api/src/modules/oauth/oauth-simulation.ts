const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalDbUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOCAL_DB_HOSTS.has(host) || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

/**
 * The simulated Google / Microsoft sign-in (codes `sim_google_<email>`, `sim_ms_<email>`, or an unconfigured provider) trusts the
 * caller's claimed e-mail address, so it is honoured ONLY under automated tests (NODE_ENV=test) AND when the database is local.
 * Same rule as the deterministic admin OTP: development, staging and production never simulate; they use the real provider or refuse.
 */
export function oauthSimulationAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' && isLocalDbUrl(env.DATABASE_URL);
}
