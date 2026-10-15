/**
 * fetch() for the administrator console. The gateway only answers /api/v1/admin/* (and other admin routes) for a signed administrator
 * token, so every call from the console must carry it. A 401 means the session is gone (expired, revoked, or the account is no longer an
 * administrator): the stored token is removed and `orion_admin_session_expired` is dispatched so the console returns to its sign-in screen
 * instead of silently showing empty data.
 */
export const ADMIN_TOKEN_KEY = 'orion_admin_token';
export const ADMIN_EMAIL_KEY = 'orion_admin_email';
export const ADMIN_SESSION_EXPIRED_EVENT = 'orion_admin_session_expired';

export function getAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolves the active access token for administrative API calls.
 * Prioritizes `orion_admin_token` (administrator session), and only falls back
 * to `orion_access_token` (customer session) if no admin session exists.
 */
export function getAdminAccessToken(): string | null {
  const adminToken = getAdminToken();
  if (adminToken) return adminToken;
  if (typeof window !== 'undefined') {
    try {
      return localStorage.getItem('orion_access_token');
    } catch {
      return null;
    }
  }
  return null;
}

export async function adminFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getAdminAccessToken();
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && token && typeof window !== 'undefined') {
    // only when the token we sent is still the stored one (a newer sign-in may have replaced it meanwhile)
    if (getAdminToken() === token) {
      try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(ADMIN_EMAIL_KEY);
      } catch {
        /* storage unavailable */
      }
      window.dispatchEvent(new CustomEvent(ADMIN_SESSION_EXPIRED_EVENT));
    }
  }
  return res;
}
