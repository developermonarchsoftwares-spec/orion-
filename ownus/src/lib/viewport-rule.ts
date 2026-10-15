/**
 * The desktop-only rule, in one place. The restriction screen (components/mobile-responsive-guard.tsx) shows instead of the app when the window is
 * narrower than MIN_DESKTOP_WIDTH, or when the browser identifies as a phone. The same number appears in two other places that cannot import this file:
 * the Tailwind `md:` breakpoint (768px) used for the first paint before scripts run, and the media query in app/globals.css. A test keeps the three equal.
 */
export const MIN_DESKTOP_WIDTH = 768;

/** Browsers that identify as phones or small devices stay blocked whatever their width. */
export const MOBILE_UA_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

/** True when the app must be replaced by the restriction screen. A width of 0 means "unknown" and never blocks. */
export function isBlockedViewport(width: number, userAgent: string): boolean {
  if (MOBILE_UA_REGEX.test(userAgent || '')) return true;
  return width > 0 && width < MIN_DESKTOP_WIDTH;
}
