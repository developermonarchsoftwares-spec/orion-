'use client';

import React from 'react';
import { 
  Sparkles, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  Layers, 
  Zap, 
  Globe, 
  Building2, 
  Cpu, 
  ArrowRight,
  RefreshCw
} from 'lucide-react';

export function DataEnrichmentView() {
  const enrichmentStats = [
    { label: 'Ready for Enrichment', count: '120,450', desc: 'Validated MSME records awaiting scraping & tech discovery', icon: Sparkles },
    { label: 'Pending Queue', count: '42,100', desc: 'Dispatched to background enrichment workers', icon: Clock },
    { label: 'Queued for Verification', count: '15,000', desc: 'GSTIN tax filing & telephone verify queue', icon: Layers },
    { label: 'Failed Enrichment Runs', count: '320', desc: 'Unreachable domains or dead endpoints', icon: AlertCircle },
  ];

  return (
    <div className="space-y-6 pb-12 text-zinc-900 dark:text-zinc-100 text-xs">
      
      {/* Overview Notice */}
      <div className="p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 uppercase">
              MODULE STATUS: PREVIEW
            </span>
            <span className="font-mono text-xs font-semibold text-zinc-500">Pipeline v1.0 Architecture</span>
          </div>
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">AI Data Enrichment & Tech Stack Discovery</h2>
          <p className="text-zinc-500 text-xs">Automated enrichment workers discover technology stacks, GSTIN filings, social profiles, and decision-maker contact points.</p>
        </div>

        <button
          disabled
          className="px-4 py-2 rounded-lg font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border border-zinc-200 dark:border-zinc-700 cursor-not-allowed shrink-0"
        >
          Enrichment Engine Paused
        </button>
      </div>

      {/* 4 Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {enrichmentStats.map((st, i) => {
          const Icon = st.icon;
          return (
            <div key={i} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-medium">{st.label}</span>
                <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100">{st.count}</div>
              <p className="text-[11px] text-zinc-500">{st.desc}</p>
            </div>
          );
        })}
      </div>

      {/* Pipeline Architecture Placeholder */}
      <div className="bg-white dark:bg-zinc-950 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-6">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Enrichment Worker Lifecycle (Planned)</h3>
          <p className="text-zinc-500 mt-0.5">As per product requirements, automated AI enrichment is prepared for rollout following data ingestion scale-up.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1. Web Presence Crawler', desc: 'Crawls official domain, scans DNS records, and identifies SSL / Hosting providers.' },
            { step: '2. Tech Stack Profiler', desc: 'Detects e-commerce engines (Shopify, WooCommerce), ERPs (SAP, Tally, Zoho) and CRM tooling.' },
            { step: '3. GSTIN Registry Sync', desc: 'Validates active legal entity status against official tax master directories.' },
            { step: '4. Executive Decision Contacts', desc: 'Identifies publicly available director names and official department inboxes.' },
          ].map((item, idx) => (
            <div key={idx} className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-2">
              <span className="font-mono text-xs font-bold text-zinc-900 dark:text-white block">{item.step}</span>
              <p className="text-[11px] text-zinc-500 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
