/** Browser-side consent state for visitors and signed-in users. Essential cookies/storage need no consent; everything else is off until the visitor opts in. */
export const CONSENT_KEY = "orion_consent_v1";
export const POLICY_VERSION = "2026-10-07";

export interface ILocalConsent {
  analytics: boolean;
  marketing: boolean;
  decided: boolean;
  version: string;
  at: string | null;
}

const DEFAULT: ILocalConsent = { analytics: false, marketing: false, decided: false, version: POLICY_VERSION, at: null };

export function getLocalConsent(): ILocalConsent {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(CONSENT_KEY) : null;
    if (!raw) return DEFAULT;
    const c = { ...DEFAULT, ...JSON.parse(raw) } as ILocalConsent;
    // A new policy version invalidates earlier choices: ask again.
    return c.version === POLICY_VERSION ? c : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setLocalConsent(patch: Partial<Pick<ILocalConsent, "analytics" | "marketing">>): ILocalConsent {
  const next: ILocalConsent = { ...getLocalConsent(), ...patch, decided: true, version: POLICY_VERSION, at: new Date().toISOString() };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("orion:consent", { detail: next }));
  } catch {
    /* storage unavailable: the choice applies to this page view only */
  }
  return next;
}

/** True only when the visitor has opted in to analytics. Gate any analytics script on this. */
export const analyticsAllowed = () => getLocalConsent().analytics;
