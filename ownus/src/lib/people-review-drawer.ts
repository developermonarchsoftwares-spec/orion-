/**
 * Pure rules of the People Review drawers (role dossier, quarantine item): what they show while loading and when loading fails, which
 * key closes them, and how Tab wraps inside them. The React side only wires these to the DOM. No DOM, no API calls.
 */

export type DrawerSubject = 'role' | 'quarantine item';

export interface IDrawerFailure {
  /** A distinct "unavailable" state, never confused with loading. */
  title: string;
  message: string;
  /** Worth offering Retry: a transient failure, not "gone" or "not allowed". */
  retryable: boolean;
}

export const FORBIDDEN_MESSAGE = 'You do not have permission to do this.';

/** What the drawer says when the item could not be loaded, from the HTTP status the review API answered (0 / undefined = no answer). */
export function classifyLoadFailure(status: number | undefined, apiMessage: string | undefined, subject: DrawerSubject): IDrawerFailure {
  const Subject = subject.charAt(0).toUpperCase() + subject.slice(1);
  if (status === 403) return { title: `${Subject} unavailable`, message: FORBIDDEN_MESSAGE, retryable: false };
  if (status === 404) return { title: `${Subject} not found`, message: `This ${subject} does not exist or is no longer available.`, retryable: false };
  if (status === 401) return { title: `${Subject} unavailable`, message: 'Your session has expired. Sign in again.', retryable: false };
  return { title: `${Subject} unavailable`, message: apiMessage?.trim() || 'It could not be loaded. Check your connection and try again.', retryable: true };
}

export type DrawerPhase = 'loading' | 'ready' | 'unavailable';

/** loading -> ready | unavailable. Data wins over a stale error (a retry that succeeded); an error wins over loading. */
export const drawerPhase = (hasData: boolean, failure: IDrawerFailure | null): DrawerPhase => (hasData ? 'ready' : failure ? 'unavailable' : 'loading');

export const drawerTitle = (phase: DrawerPhase, subject: DrawerSubject, failure: IDrawerFailure | null, readyTitle: string): string =>
  phase === 'ready' ? readyTitle : phase === 'unavailable' ? (failure?.title ?? 'Unavailable') : 'Loading...';

/** Escape closes a drawer, unless something else already handled the key (an open select, an IME). */
export const isCloseKey = (key: string, defaultPrevented: boolean): boolean => key === 'Escape' && !defaultPrevented;

/**
 * Tab inside a modal drawer: which focusable index to move to when Tab would leave it, or null to let the browser move focus normally.
 * `active` is the index of the focused element among the drawer's focusable elements (-1 = focus is outside / on the drawer itself).
 */
export function nextFocusTarget(count: number, active: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (active === -1) return shift ? count - 1 : 0;
  if (!shift && active === count - 1) return 0;
  if (shift && active === 0) return count - 1;
  return null;
}

/** Enter or Space on a focused queue row opens it (rows are keyboard-reachable like links). */
export const isActivateKey = (key: string): boolean => key === 'Enter' || key === ' ';
