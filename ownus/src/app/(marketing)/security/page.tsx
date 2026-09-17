import type { Metadata } from 'next';
import Link from 'next/link';
import { 
  ShieldCheck, 
  Lock, 
  KeyRound, 
  FileSpreadsheet, 
  Server, 
  Layers, 
  AlertCircle, 
  CheckCircle2, 
  Mail, 
  Cpu, 
  RefreshCw,
  EyeOff
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Security Architecture & Practices | Orion',
  description: 'Explore the security measures, authentication safeguards, data isolation, and defensive engineering practices implemented across the Orion platform.',
};

export default function SecurityPage() {
  const securityPillars = [
    {
      title: 'Identity & Authentication',
      icon: KeyRound,
      description: 'Defending account access through cryptographic tokens, OAuth 2.0, and multi-factor admin gateways.',
      highlights: [
        'Short-lived JWT access tokens paired with high-entropy signed refresh tokens',
        'Secure HTTP-only, SameSite cookies to mitigate Cross-Site Scripting (XSS) risks',
        'Google OAuth 2.0 single sign-on with strict profile scope limitations',
        'Salted cryptographic hashing for password-based credentials',
        'Two-factor OTP challenge gateway guarding all administrative console access',
      ],
    },
    {
      title: 'Data Isolation & RBAC',
      icon: Layers,
      description: 'Strict multi-tenant architecture ensuring complete boundary separation across organizational accounts.',
      highlights: [
        'Rigid Role-Based Access Control (RBAC) separating standard users and platform operators',
        'Row-level tenant boundary checks preventing cross-organization query leakage',
        'Isolated customer lead repositories, saved searches, and transaction ledgers',
        'Scoped API token permissions ensuring requests operate with least privilege',
      ],
    },
    {
      title: 'Data Ingestion & CSV Sanitization',
      icon: FileSpreadsheet,
      description: 'Automated validation pipelines guarding against malicious file payloads and spreadsheet injection.',
      highlights: [
        'MIME-type enforcement and file-size quota checks prior to file acceptance',
        'Spreadsheet formula injection sanitization neutralizing dangerous leading characters (=, +, -, @)',
        'Strict schema validation against expected 20-field business record formats',
        'Isolated private object storage buckets with signed URL access controls',
      ],
    },
    {
      title: 'Transport & Gateway Protections',
      icon: Server,
      description: 'Securing the transit path between web clients, gateways, and upstream microservices.',
      highlights: [
        'Mandatory TLS 1.3 / HTTPS encryption for all browser and API requests',
        'API Gateway path traversal defenses preventing directory escape attempts',
        'Rate limiting and request throttling on authentication routes to mitigate brute-force attacks',
        'CORS policy restrictions preventing unauthorized third-party origins',
      ],
    },
  ];

  return (
    <div className="bg-white dark:bg-black text-gray-900 dark:text-gray-100 min-h-screen pt-28 pb-20 sm:pt-32 sm:pb-24">
      {/* Hero Header */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 mb-16">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-neutral-900 text-gray-700 dark:text-neutral-300 border border-gray-200 dark:border-neutral-800 mb-4">
          <ShieldCheck className="w-3.5 h-3.5 text-gray-900 dark:text-white" />
          <span>Platform Security Overview</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-white mb-5">
          Defensive Engineering at Orion
        </h1>
        <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-3xl leading-relaxed">
          Security is built into Orion from the ground up. We believe in complete transparency: this page outlines the actual security controls, architectural protections, and defensive safeguards actively implemented across the Orion platform.
        </p>

        {/* Realistic Trust Statement */}
        <div className="mt-8 p-4 sm:p-5 rounded-xl border border-gray-200 dark:border-neutral-800 bg-gray-50/70 dark:bg-neutral-950/60 flex items-start gap-3 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
          <AlertCircle className="w-5 h-5 text-gray-900 dark:text-white shrink-0 mt-0.5" />
          <p>
            <strong className="text-gray-900 dark:text-white font-semibold">Honest & Direct Security Posture:</strong> We do not rely on inflated compliance badges or make unverified marketing claims. Our security model is grounded in robust software engineering practices, multi-layer boundary defense, least-privilege access, and proactive data sanitization.
          </p>
        </div>
      </div>

      {/* Main Security Pillars Grid */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 mb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {securityPillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <div
                key={pillar.title}
                className="p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-neutral-800 bg-gray-50/40 dark:bg-neutral-950/40 hover:border-gray-300 dark:hover:border-neutral-700 transition-all duration-200 flex flex-col justify-between"
              >
                <div>
                  <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 flex items-center justify-center text-gray-900 dark:text-white mb-5">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-2">
                    {pillar.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                    {pillar.description}
                  </p>
                  <ul className="space-y-3 text-xs sm:text-sm text-gray-700 dark:text-gray-300">
                    {pillar.highlights.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Deep-Dive Architectural Controls */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Contact Masking & Redaction */}
        <section className="p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-neutral-900 flex items-center justify-center text-gray-900 dark:text-white">
              <EyeOff className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Data Masking & Credit Authorization
            </h2>
          </div>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
            Orion enforces automated server-side data redaction. In search and discovery listings, sensitive executive emails, personal telephone numbers, and direct identifiers are redacted at the API level before delivery to the client.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs sm:text-sm">
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-neutral-900/60 border border-gray-200 dark:border-neutral-800">
              <span className="font-semibold text-gray-900 dark:text-white block mb-1">Server-Side Redaction</span>
              <p className="text-gray-600 dark:text-gray-400">
                Contact information is not merely hidden with CSS; sensitive fields are completely omitted from responses until an explicit credit unlock authorization is validated.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-neutral-900/60 border border-gray-200 dark:border-neutral-800">
              <span className="font-semibold text-gray-900 dark:text-white block mb-1">Atomic Credit Deduction</span>
              <p className="text-gray-600 dark:text-gray-400">
                Unlocks are processed within database transactions, preventing double-spend exploits and ensuring transparent ledger auditing for your organization.
              </p>
            </div>
          </div>
        </section>

        {/* Operational Security & Responsible Disclosure */}
        <section className="p-6 sm:p-8 rounded-2xl border border-gray-200 dark:border-neutral-800 bg-gray-50/30 dark:bg-neutral-950/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-neutral-900 flex items-center justify-center text-gray-900 dark:text-white">
              <Mail className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              Vulnerability Disclosure & Security Inquiries
            </h2>
          </div>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 leading-relaxed mb-6">
            We welcome constructive reports from security researchers and customers. If you believe you have discovered a vulnerability, security flaw, or potential exposure in Orion, please notify our engineering team promptly.
          </p>
          
          <div className="p-5 rounded-xl border border-gray-200 dark:border-neutral-800 bg-white dark:bg-black flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Monarch Softwares Security Response</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Dedicated inbox for vulnerability reports and security inquiries</p>
            </div>
            <a
              href="mailto:security@monarchsoftwares.com"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-black text-white dark:bg-white dark:text-black font-semibold text-sm hover:opacity-90 transition-opacity"
            >
              <Mail className="w-4 h-4" />
              security@monarchsoftwares.com
            </a>
          </div>

          <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>&bull; Please provide detailed steps to reproduce the issue, including request payloads and affected endpoints.</p>
            <p>&bull; Do not access or modify customer data, and allow reasonable time for remediation prior to public disclosure.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
