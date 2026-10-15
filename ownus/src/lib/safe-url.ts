/**
 * A link target that is safe to put in an `href`. Company websites and LinkedIn pages come from imported data (untrusted text), and a
 * value such as `javascript:...` or `data:text/html,...` would run script in the visitor's page when clicked. Only an http or https
 * address without embedded credentials is returned; anything else gives `undefined`, so the element renders as plain, non-clickable
 * text. A bare address ("example.com/about") is treated as https, as the app always has. Defence in depth: the API also refuses such
 * values at import time, but data stored before that change, or by another path, must not become a script-capable link.
 */
export function safeHttpHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > 2000 || /[\u0000-\u001f\u007f]/.test(text)) return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(candidate);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname && !u.username && !u.password) return u.href;
  } catch {
    /* not a URL */
  }
  return undefined;
}
