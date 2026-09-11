'use client';

import React, { useState, useMemo } from 'react';
import { 
  BrainCircuit, 
  Sparkles, 
  Layers, 
  ShieldCheck, 
  AlertTriangle, 
  TrendingUp, 
  CheckCircle2, 
  Activity, 
  Radio, 
  Cpu, 
  Workflow, 
  RefreshCw, 
  HeartPulse, 
  ArrowUpRight, 
  Globe, 
  Mail, 
  Phone, 
  FileText, 
  Bell, 
  Filter,
  XCircle,
  Clock,
  ExternalLink
} from 'lucide-react';
import { 
  AdminBusinessRecord, 
  AdminTab, 
  DataSourceRecord, 
  EnrichmentJob, 
  AiPipelineDefinition, 
  AutomationRule, 
  SystemServiceHealth 
} from '@/types/admin';

interface DataIntelligenceViewProps {
  records: AdminBusinessRecord[];
  sources: DataSourceRecord[];
  enrichmentJobs: EnrichmentJob[];
  pipelines: AiPipelineDefinition[];
  rules: AutomationRule[];
  systemServices: SystemServiceHealth[];
  onNavigateTab: (tab: AdminTab) => void;
  onSelectBusiness?: (record: AdminBusinessRecord) => void;
}

export const DataIntelligenceView: React.FC<DataIntelligenceViewProps> = ({
  records,
  sources,
  enrichmentJobs,
  pipelines,
  rules,
  systemServices,
  onNavigateTab,
  onSelectBusiness,
}) => {
  const [timelineFilter, setTimelineFilter] = useState<string>('all');
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  // Calculate high-precision data quality metrics
  const metrics = useMemo(() => {
    const total = records.length || 1;
    const missingWebsiteCount = records.filter(r => !r.hasWebsite && (!r.website || r.website === '' || r.website === 'N/A')).length;
    const missingEmailCount = records.filter(r => !r.email || r.email === '' || r.email === 'N/A' || r.emailStatus === 'missing').length;
    const missingPhoneCount = records.filter(r => !r.phone || r.phone === '' || r.phoneStatus === 'missing').length;
    const duplicatesCount = records.filter(r => r.isDuplicate).length;

    const avgQualityScore = Math.round(records.reduce((acc, r) => acc + (r.dataQualityScore || 85), 0) / total);
    const avgOpportunityScore = Math.round(records.reduce((acc, r) => acc + (r.opportunityScore || 78), 0) / total);

    const missingWebsiteRate = ((missingWebsiteCount / total) * 100).toFixed(1);
    const missingEmailRate = ((missingEmailCount / total) * 100).toFixed(1);
    const missingPhoneRate = ((missingPhoneCount / total) * 100).toFixed(1);
    const duplicateRate = ((duplicatesCount / total) * 100).toFixed(1);

    const recentlyAdded = records.filter(r => r.createdAt && r.createdAt.includes('2024-09')).length;
    const recentlyUpdated = records.filter(r => r.updatedAt && r.updatedAt.includes('2024-09')).length;

    return {
      total,
      avgQualityScore,
      avgOpportunityScore,
      missingWebsiteRate,
      missingWebsiteCount,
      missingEmailRate,
      missingEmailCount,
      missingPhoneRate,
      missingPhoneCount,
      duplicateRate,
      duplicatesCount,
      recentlyAdded,
      recentlyUpdated,
    };
  }, [records]);

  // System Notifications & Alerts (Section 9)
  const systemAlerts = useMemo(() => {
    const alerts = [
      {
        id: 'alt-1',
        title: 'MSME Source Latency Spike',
        message: 'Endpoint response time increased to 420ms on batch cursor fetch.',
        severity: 'warning' as const,
        time: '12m ago',
        category: 'Data Source'
      },
      {
        id: 'alt-2',
        title: 'Phone Validation MX / Carrier Throttle',
        message: '24 telecom carrier lookups rate-limited by national pool.',
        severity: 'warning' as const,
        time: '25m ago',
        category: 'Validation Errors'
      },
      {
        id: 'alt-3',
        title: 'Auto-Publish Rule RULE-01 Active',
        message: 'Published 450 verified business records into Discover in last hour.',
        severity: 'info' as const,
        time: '1h ago',
        category: 'Automation'
      }
    ];

    return alerts.filter(a => !dismissedAlerts.includes(a.id));
  }, [dismissedAlerts]);

  // Unified Activity Timeline (Section 8)
  const timelineEvents = useMemo(() => {
    const rawEvents = [
      {
        id: 'ev-1',
        type: 'AI Jobs',
        title: 'Neural Entity Deduplication Completed',
        description: 'Scanned 14,200 incoming candidates against master embedding index (18ms avg latency).',
        timestamp: '10 minutes ago',
        icon: BrainCircuit,
        badge: 'Triton GPU'
      },
      {
        id: 'ev-2',
        type: 'Imports',
        title: 'MSME Registry Delta Stream Synchronized',
        description: 'Fetched 1,240 verified enterprise entities from Udyam registration portal.',
        timestamp: '15 minutes ago',
        icon: Radio,
        badge: 'Source Sync'
      },
      {
        id: 'ev-3',
        type: 'Automation',
        title: 'Auto-Publish Policy RULE-01 Triggered',
        description: 'Executed auto-publication on 18 businesses with data quality score >= 90%.',
        timestamp: '32 minutes ago',
        icon: Workflow,
        badge: 'Automation'
      },
      {
        id: 'ev-4',
        type: 'Validation',
        title: '20-Field Schema Validation Completed',
        description: 'Validated 1,420 businesses. 98.4% passed format syntax and GSTIN checks.',
        timestamp: '1 hour ago',
        icon: ShieldCheck,
        badge: 'Validation'
      },
      {
        id: 'ev-5',
        type: 'Publishing',
        title: 'Search Index Re-Segmented and Flushed',
        description: 'Optimized 6 Elasticsearch shards. 1,120,400 documents live for customer queries.',
        timestamp: '2 hours ago',
        icon: RefreshCw,
        badge: 'Index Sync'
      },
      {
        id: 'ev-6',
        type: 'System Events',
        title: 'Triton Inference Cluster Auto-Scaled',
        description: 'Allocated 4x NVIDIA A100 Tensor Core GPUs to accommodate evening batch surge.',
        timestamp: '3 hours ago',
        icon: HeartPulse,
        badge: 'Infrastructure'
      }
    ];

    if (timelineFilter === 'all') return rawEvents;
    return rawEvents.filter(e => e.type === timelineFilter);
  }, [timelineFilter]);

  const handleDismissAlert = (id: string) => {
    setDismissedAlerts(prev => [...prev, id]);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
              <BrainCircuit className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Data Intelligence & Automation Hub
                </h1>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  Orion v4.0 Engine
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                End-to-end data pipeline orchestrator preparing, enriching, scoring, and verifying business records before Discover publication.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateTab('automation')}
            className="flex items-center gap-2 px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold rounded-xl transition-colors shadow-sm"
          >
            <Workflow className="w-3.5 h-3.5" />
            <span>Configure Automation</span>
          </button>
        </div>
      </div>

      {/* Module 4 Quick Jump Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <button
          onClick={() => onNavigateTab('sources')}
          className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-all text-left group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <Radio className="w-4 h-4 text-zinc-600 dark:text-zinc-400 group-hover:text-emerald-500 transition-colors" />
            <span className="text-[10px] font-mono text-zinc-400">8 Sources</span>
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Data Sources</div>
          <div className="text-[11px] text-zinc-500 truncate">MSME, MCA, GSTN</div>
        </button>

        <button
          onClick={() => onNavigateTab('enrichment_queue')}
          className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-all text-left group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <Sparkles className="w-4 h-4 text-zinc-600 dark:text-zinc-400 group-hover:text-amber-500 transition-colors" />
            <span className="text-[10px] font-mono text-zinc-400">9 Modules</span>
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Enrichment Queue</div>
          <div className="text-[11px] text-zinc-500 truncate">Async workers active</div>
        </button>

        <button
          onClick={() => onNavigateTab('ai_processing')}
          className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-all text-left group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <Cpu className="w-4 h-4 text-zinc-600 dark:text-zinc-400 group-hover:text-blue-500 transition-colors" />
            <span className="text-[10px] font-mono text-zinc-400">5 Models</span>
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">AI Processing</div>
          <div className="text-[11px] text-zinc-500 truncate">Triton GPU inference</div>
        </button>

        <button
          onClick={() => onNavigateTab('automation')}
          className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-all text-left group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <Workflow className="w-4 h-4 text-zinc-600 dark:text-zinc-400 group-hover:text-purple-500 transition-colors" />
            <span className="text-[10px] font-mono text-zinc-400">6 Rules</span>
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Automation</div>
          <div className="text-[11px] text-zinc-500 truncate">Policies & triggers</div>
        </button>

        <button
          onClick={() => onNavigateTab('sync_center')}
          className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-all text-left group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <RefreshCw className="w-4 h-4 text-zinc-600 dark:text-zinc-400 group-hover:text-emerald-500 transition-colors" />
            <span className="text-[10px] font-mono text-zinc-400">1.12M Docs</span>
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Sync Center</div>
          <div className="text-[11px] text-zinc-500 truncate">Search index shards</div>
        </button>

        <button
          onClick={() => onNavigateTab('system_health')}
          className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-600 transition-all text-left group shadow-sm"
        >
          <div className="flex items-center justify-between mb-2">
            <HeartPulse className="w-4 h-4 text-zinc-600 dark:text-zinc-400 group-hover:text-red-500 transition-colors" />
            <span className="text-[10px] font-mono text-emerald-500">Healthy</span>
          </div>
          <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">System Health</div>
          <div className="text-[11px] text-zinc-500 truncate">8 services online</div>
        </button>
      </div>

      {/* Section 7: Data Quality Dashboard */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Data Quality & Catalog Health Dashboard
            </h2>
          </div>
          <span className="text-xs text-zinc-500">Real-time catalog analytics</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {/* Overall Quality */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Overall Quality
            </div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {metrics.avgQualityScore}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Catalog benchmark
            </div>
          </div>

          {/* Orion Commercial Score */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Avg Orion Score
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {metrics.avgOpportunityScore} <span className="text-xs text-zinc-400 font-normal">/ 100</span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Commercial viability
            </div>
          </div>

          {/* Duplicate Rate */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Duplicate Rate
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {metrics.duplicateRate}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              {metrics.duplicatesCount} flagged pairs
            </div>
          </div>

          {/* Missing Website */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Missing Website
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {metrics.missingWebsiteRate}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Target for enrichment
            </div>
          </div>

          {/* Missing Email */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Missing Email
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {metrics.missingEmailRate}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              Domain lookup ready
            </div>
          </div>

          {/* Missing Phone */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Missing Phone
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {metrics.missingPhoneRate}%
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              High contactability
            </div>
          </div>

          {/* Recently Added */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Recently Added
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              +{metrics.recentlyAdded}
            </div>
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
              This month
            </div>
          </div>

          {/* Recently Updated */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl shadow-sm">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
              Recently Updated
            </div>
            <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
              {metrics.recentlyUpdated}
            </div>
            <div className="text-[10px] text-zinc-500 mt-1">
              AI enriched
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Notifications & Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Section 9: Notifications & Health Alerts */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                System Alerts & Exceptions
              </h3>
            </div>
            <span className="text-[10px] font-mono font-semibold bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-600 dark:text-zinc-400">
              {systemAlerts.length} Active
            </span>
          </div>

          <div className="space-y-3">
            {systemAlerts.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
                <p className="text-xs text-zinc-500">No active system alerts. All ingestion streams healthy.</p>
              </div>
            ) : (
              systemAlerts.map(alert => (
                <div
                  key={alert.id}
                  className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-1 relative"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-semibold text-zinc-500 uppercase">
                      {alert.category}
                    </span>
                    <span className="text-[10px] text-zinc-400">{alert.time}</span>
                  </div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    {alert.title}
                  </h4>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    {alert.message}
                  </p>
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => handleDismissAlert(alert.id)}
                      className="text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 underline"
                    >
                      Acknowledge
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Section 8: Activity Timeline */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Pipeline Activity Timeline
              </h3>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {['all', 'Imports', 'Validation', 'Publishing', 'Automation', 'AI Jobs'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setTimelineFilter(tab)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    timelineFilter === tab
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 font-semibold'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  }`}
                >
                  {tab === 'all' ? 'All Events' : tab}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4 relative pl-4 border-l border-zinc-200 dark:border-zinc-800">
            {timelineEvents.map(event => {
              const Icon = event.icon;
              return (
                <div key={event.id} className="relative group space-y-1">
                  {/* Timeline bullet */}
                  <div className="absolute -left-[23px] top-1 p-1 rounded-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 group-hover:border-zinc-900 dark:group-hover:border-zinc-100 transition-colors">
                    <Icon className="w-2.5 h-2.5" />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                        {event.title}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                        {event.badge}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 font-mono">{event.timestamp}</span>
                  </div>

                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    {event.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
