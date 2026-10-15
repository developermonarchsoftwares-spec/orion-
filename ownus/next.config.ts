import type { NextConfig } from "next";
import { allHeaderRules } from "./src/lib/security-headers";

/**
 * Browser security headers (S-12, revised in Phase 14). The policy itself lives in src/lib/security-headers.ts so it can be unit tested:
 * CSP (connect-src limited to this site and the configured API origin), a report-only strict CSP in production, X-Frame-Options and
 * frame-ancestors, nosniff, Referrer-Policy (no-referrer on the reset page), Permissions-Policy, COOP, HSTS in production WITHOUT
 * includeSubDomains or preload, and no-store on /api and private cache rules on the signed-in page shells.
 *
 * Still open and documented: 'unsafe-inline' for scripts and styles (Next.js hydration and the theme script are inline); removing it needs a
 * per-request nonce through middleware and dynamic rendering of every page.
 */
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  serverExternalPackages: ['bcrypt', 'pg'],
  // S-12: do not advertise the framework/version.
  poweredByHeader: false,
  // Phase 14: browser source maps would publish the original source of the app; keep them off in production (this is also Next's default).
  productionBrowserSourceMaps: false,
  async headers() {
    return allHeaderRules({ isProd, apiUrl: process.env.NEXT_PUBLIC_API_URL });
  },
};

export default nextConfig;
