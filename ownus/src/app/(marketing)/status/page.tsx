import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import { StatusDashboard } from '@/components/status/status-dashboard';

export const metadata: Metadata = {
  title: 'System Status | Orion',
  description: 'Real-time service availability, latency metrics, and operational health of Orion platform components and pipelines.',
};

export default function StatusPage() {
  return (
    <div className="bg-white dark:bg-black text-gray-900 dark:text-gray-100 min-h-screen pt-28 pb-20 sm:pt-32 sm:pb-24">
      {/* Header Banner */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 mb-10 text-center sm:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-neutral-900 text-gray-700 dark:text-neutral-300 border border-gray-200 dark:border-neutral-800 mb-4">
          <Activity className="w-3.5 h-3.5 text-gray-900 dark:text-white" />
          <span>Platform Observability</span>
        </div>
        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-white mb-3">
          System Status
        </h1>
        <p className="text-base sm:text-lg text-gray-600 dark:text-gray-400 max-w-3xl leading-relaxed">
          Real-time service health, uptime statistics, and operational telemetry for the Orion business intelligence platform.
        </p>
      </div>

      {/* Interactive Status Dashboard */}
      <StatusDashboard />
    </div>
  );
}
