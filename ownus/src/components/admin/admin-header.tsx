'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Search, 
  UploadCloud, 
  Download, 
  RefreshCw, 
  Bell,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  UserPlus,
  LifeBuoy,
  FileCheck2,
  ExternalLink,
  LogOut,
  X
} from 'lucide-react';
import { AdminTab } from './admin-sidebar';

interface AdminHeaderProps {
  activeTab: AdminTab;
  onOpenSearch: () => void;
  onNavigateTab: (tab: AdminTab) => void;
  onRefreshData?: () => void;
  isRefreshing?: boolean;
  adminEmail?: string;
  onSignOut?: () => void;
}

const TAB_TITLES: Record<AdminTab, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Operations Dashboard',
    subtitle: 'System-wide ingest rates, data quality scores & operational pipeline'
  },
  records: {
    title: 'Business Records Master',
    subtitle: 'Explore, filter and edit 1.2M+ validated and draft business records'
  },
  import: {
    title: 'Import & Ingestion Wizard',
    subtitle: 'Upload CSV/Excel, map 20+ columns and run real-time schema validation'
  },
  history: {
    title: 'Import History & Batches',
    subtitle: 'Audit log of historical ingestion jobs, error logs, and retry handlers'
  },
  validation: {
    title: 'Data Quality & Validation Rules',
    subtitle: 'Catch missing business names, invalid contact details and format violations'
  },
  duplicates: {
    title: 'Deduplication & Merge Engine',
    subtitle: 'Resolve similarity conflicts across phone numbers, emails, domains and addresses'
  },
  publish_queue: {
    title: 'Publish Queue & Approval Pipeline',
    subtitle: 'Final verification gate: approve, publish, reject or draft businesses for Discover'
  },
  enrichment: {
    title: 'Data Enrichment Pipeline',
    subtitle: 'Queue workers for automated web scraping, GST lookup, and social intelligence'
  },
  published: {
    title: 'Published Businesses (Live Directory)',
    subtitle: 'Live verified businesses visible to Orion subscribers in Discover'
  },
  users: {
    title: 'Customer & User Management',
    subtitle: 'Manage Orion subscribers, account statuses, credit allocations, and usage history'
  },
  credits: {
    title: 'Credits Economy & Transactions',
    subtitle: 'Track platform credit purchases, consumption rates, invoices, and refund requests'
  },
  roles: {
    title: 'Roles & Granular Permissions',
    subtitle: 'Define role matrices (Super Admin, Reviewer, Support, Finance) across 12 modules'
  },
  reports: {
    title: 'Executive Reports & Platform Analytics',
    subtitle: '12 KPI cards, growth curves, geographic distributions, and master data exports'
  },
  settings: {
    title: 'System & Application Settings',
    subtitle: 'Configure taxonomies, credit packages, subscription tiers, validation & email templates'
  },
  logs: {
    title: 'Immutable Platform Activity Logs',
    subtitle: 'Audit every user registration, authentication, data update, and ledger transaction'
  },
  support: {
    title: 'Customer Support Center',
    subtitle: 'Manage support tickets, SLAs, resolution timelines, and customer inquiries'
  },
  data_intelligence: {
    title: 'Data Intelligence & AI Orchestration',
    subtitle: 'Holistic data quality metrics, enrichment pipeline throughput, and automated scoring'
  },
  sources: {
    title: 'Government & External Data Sources',
    subtitle: 'Manage 8 multi-channel ingestion connectors (MSME, MCA, GST, FSSAI, Startup India)'
  },
  enrichment_queue: {
    title: 'Async Data Enrichment Queue',
    subtitle: 'Real-time job queue for website detection, phone verification, social and AI summaries'
  },
  ai_processing: {
    title: 'AI Processing & Deep Inference Engine',
    subtitle: 'Transformer classification, neural deduplication, opportunity scoring & lookalike graphs'
  },
  automation: {
    title: 'Automation & Rule Builder',
    subtitle: 'Trigger-condition-action workflow engine for auto-publishing, categorization & quarantine'
  },
  sync_center: {
    title: 'Search Index & Sync Center',
    subtitle: 'Monitor 1.12M+ Elasticsearch index documents, shard distribution & reindex sync'
  },
  system_health: {
    title: 'Platform Infrastructure Health',
    subtitle: 'Observability across ingestion, validation, database, AI GPU workers, and Redis caches'
  }
};

interface NotificationItem {
  id: string;
  type: 'import' | 'validation' | 'publish' | 'payment' | 'user' | 'support';
  title: string;
  description: string;
  time: string;
  read: boolean;
  actionTab?: AdminTab;
}

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    type: 'payment',
    title: 'Payment Received',
    description: 'Aarav Singhania purchased Scale Credit Pack (₹44,999)',
    time: '5 mins ago',
    read: false,
    actionTab: 'credits'
  },
  {
    id: 'notif-2',
    type: 'support',
    title: 'Support Ticket Created',
    description: 'Critical Ticket TCK-404 created: Suspension notice inquiry',
    time: '25 mins ago',
    read: false,
    actionTab: 'support'
  },
  {
    id: 'notif-3',
    type: 'publish',
    title: 'Businesses Published',
    description: '142 verified records from Maharashtra published to Discover',
    time: '1 hour ago',
    read: false,
    actionTab: 'published'
  },
  {
    id: 'notif-4',
    type: 'user',
    title: 'New User Registered',
    description: 'Ananya Roy (Bengal Analytics) created a new Starter account',
    time: '2 hours ago',
    read: true,
    actionTab: 'users'
  },
  {
    id: 'notif-5',
    type: 'import',
    title: 'Import Completed',
    description: 'Batch IMP-4829 successfully ingested 14,200 records',
    time: '4 hours ago',
    read: true,
    actionTab: 'history'
  },
  {
    id: 'notif-6',
    type: 'validation',
    title: 'Validation Completed',
    description: 'Automated verification check completed for Karnataka batch',
    time: '6 hours ago',
    read: true,
    actionTab: 'validation'
  }
];

export function AdminHeader({
  activeTab,
  onOpenSearch,
  onNavigateTab,
  onRefreshData,
  isRefreshing,
  adminEmail,
  onSignOut
}: AdminHeaderProps) {
  const current = TAB_TITLES[activeTab] || { title: 'Admin Platform', subtitle: 'Platform Operations' };
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleNotificationClick = (item: NotificationItem) => {
    setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
    if (item.actionTab) {
      onNavigateTab(item.actionTab);
    }
    setShowNotifDropdown(false);
  };

  const getNotificationIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'payment':
        return <CreditCard className="w-3.5 h-3.5 text-zinc-300" />;
      case 'support':
        return <LifeBuoy className="w-3.5 h-3.5 text-zinc-300" />;
      case 'publish':
        return <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" />;
      case 'user':
        return <UserPlus className="w-3.5 h-3.5 text-zinc-300" />;
      case 'import':
        return <UploadCloud className="w-3.5 h-3.5 text-zinc-300" />;
      case 'validation':
        return <FileCheck2 className="w-3.5 h-3.5 text-zinc-300" />;
      default:
        return <AlertCircle className="w-3.5 h-3.5 text-zinc-300" />;
    }
  };

  return (
    <header className="h-16 shrink-0 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Title and Breadcrumb */}
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-2 text-[10px] font-mono tracking-wide leading-none mb-1">
          <span className="text-zinc-400 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            ORION ADMIN
          </span>
          <span className="text-zinc-600">/</span>
          <span className="uppercase text-indigo-400 font-bold bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded leading-none">
            {activeTab}
          </span>
        </div>
        <h1 className="text-lg font-bold text-white tracking-tight leading-tight">
          {current.title}
        </h1>
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center gap-2.5">
        {/* Global Admin Search Trigger */}
        <button
          onClick={onOpenSearch}
          type="button"
          className="flex items-center gap-2.5 px-3 h-9 text-xs text-zinc-400 bg-zinc-900/90 hover:bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-all cursor-pointer w-48 sm:w-60 justify-between shadow-xs"
        >
          <div className="flex items-center gap-2 truncate">
            <Search className="w-3.5 h-3.5 text-zinc-400" />
            <span className="truncate">Search businesses, users...</span>
          </div>
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono font-semibold text-zinc-400 bg-zinc-950 border border-zinc-800 rounded">
            ⌘K
          </kbd>
        </button>

        {/* Notifications Dropdown Trigger */}
        <div className="relative">
          <button
            onClick={() => setShowNotifDropdown(prev => !prev)}
            title="Platform Notifications"
            className="h-9 w-9 flex items-center justify-center text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 rounded-xl transition-all cursor-pointer relative shadow-xs"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-zinc-950">
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown Panel */}
          {showNotifDropdown && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-zinc-900/95 border border-zinc-800 rounded-2xl shadow-2xl p-4 z-50 text-zinc-100 animate-in fade-in backdrop-blur-xl">
              <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Admin Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.5 rounded-full">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-[11px] text-zinc-400 hover:text-zinc-100 transition"
                    >
                      Mark all read
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotifDropdown(false)}
                    className="text-zinc-400 hover:text-zinc-200 p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-1.5 py-2 divide-y divide-zinc-800/40 scrollbar-thin">
                {notifications.map(item => (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className={`p-2.5 rounded-xl flex items-start gap-3 cursor-pointer transition ${
                      item.read ? 'hover:bg-zinc-800/40' : 'bg-zinc-800/30 hover:bg-zinc-800/70 border border-zinc-800'
                    }`}
                  >
                    <div className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 mt-0.5 shrink-0">
                      {getNotificationIcon(item.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-zinc-100 truncate">{item.title}</span>
                        <span className="text-[10px] text-zinc-400 shrink-0">{item.time}</span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Refresh Button */}
        {onRefreshData && (
          <button
            onClick={onRefreshData}
            title="Refresh current data"
            className="h-9 w-9 flex items-center justify-center text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 rounded-xl transition-all cursor-pointer shadow-xs"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        )}

        {/* Exit to User Portal */}
        <Link
          href="/dashboard"
          title="Exit Admin Console to User Portal"
          className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 hover:border-zinc-700 transition-all shadow-xs"
        >
          <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
          <span className="hidden sm:inline">User Portal</span>
        </Link>

        {/* Admin Identity Badge */}
        {adminEmail && (
          <div className="hidden lg:flex items-center gap-2 px-3 h-9 rounded-xl bg-zinc-900 border border-zinc-800 text-[11px] shadow-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-medium text-zinc-200 truncate max-w-[170px]">{adminEmail}</span>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              ADMIN
            </span>
          </div>
        )}

        {/* Admin Sign Out */}
        {onSignOut && (
          <button
            onClick={onSignOut}
            title="Sign out of Admin Portal"
            className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-xs font-medium text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 border border-zinc-800 hover:border-rose-500/30 transition-all cursor-pointer shadow-xs"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        )}

        {/* Quick Ingest Button */}
        <button
          onClick={() => onNavigateTab('import')}
          className="inline-flex items-center gap-2 px-3.5 h-9 rounded-xl text-xs font-semibold bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 border border-white/10 transition-all cursor-pointer shrink-0"
        >
          <UploadCloud className="w-4 h-4" />
          <span>New Import</span>
        </button>
      </div>
    </header>
  );
}

