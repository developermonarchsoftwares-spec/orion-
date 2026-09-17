'use client';

import React, { useState } from 'react';
import { 
  Building2, 
  CheckCircle2, 
  Clock, 
  FileText, 
  CopyX, 
  AlertTriangle, 
  UploadCloud, 
  Sparkles, 
  Users, 
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Server,
  Activity,
  HardDrive,
  Cpu,
  ArrowRight,
  ShieldCheck,
  Zap,
  Filter,
  Layers,
  Database
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  AreaChart, 
  Area, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend 
} from 'recharts';
import { AdminBusinessRecord, ImportBatch, ActivityLogEntry } from '@/types/admin';
import { AdminTab } from '../admin-sidebar';

interface AdminDashboardViewProps {
  businesses: AdminBusinessRecord[];
  batches: ImportBatch[];
  logs: ActivityLogEntry[];
  onNavigate: (tab: AdminTab) => void;
  onSelectBusiness: (business: AdminBusinessRecord) => void;
}

const ADDED_PER_DAY_DATA = [
  { day: 'Mon', added: 4200, published: 3800 },
  { day: 'Tue', added: 5100, published: 4900 },
  { day: 'Wed', added: 6800, published: 6200 },
  { day: 'Thu', added: 8420, published: 7900 },
  { day: 'Fri', added: 7200, published: 6800 },
  { day: 'Sat', added: 3100, published: 2900 },
  { day: 'Sun', added: 2400, published: 2100 },
];

const IMPORTS_PER_DAY_DATA = [
  { date: '09/02', total: 25000, failed: 980 },
  { date: '09/03', total: 18000, failed: 120 },
  { date: '09/04', total: 3200, failed: 12 },
  { date: '09/05', total: 14000, failed: 450 },
  { date: '09/06', total: 9500, failed: 80 },
  { date: '09/07', total: 8500, failed: 45 },
  { date: '09/08', total: 14200, failed: 120 },
];

const BUSINESS_GROWTH_DATA = [
  { month: 'Apr', total: 450000 },
  { month: 'May', total: 620000 },
  { month: 'Jun', total: 790000 },
  { month: 'Jul', total: 940000 },
  { month: 'Aug', total: 1100000 },
  { month: 'Sep', total: 1248930 },
];

const INDUSTRY_DATA = [
  { name: 'Manufacturing', value: 28, color: '#3B82F6' },
  { name: 'Services & B2B', value: 22, color: '#10B981' },
  { name: 'Healthcare & Pharma', value: 16, color: '#8B5CF6' },
  { name: 'Renewable Energy', value: 12, color: '#F59E0B' },
  { name: 'Logistics & Fleet', value: 10, color: '#06B6D4' },
  { name: 'Food & Agro', value: 8, color: '#EC4899' },
  { name: 'Other Sectors', value: 4, color: '#64748B' },
];

const STATE_DISTRIBUTION_DATA = [
  { state: 'Maharashtra', count: 342000, percentage: '27.4%' },
  { state: 'Karnataka', count: 285000, percentage: '22.8%' },
  { state: 'Tamil Nadu', count: 210000, percentage: '16.8%' },
  { state: 'Gujarat', count: 189000, percentage: '15.1%' },
  { state: 'Telangana', count: 124000, percentage: '9.9%' },
  { state: 'Delhi NCR', count: 98000, percentage: '7.8%' },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-zinc-900/95 border border-zinc-700/80 rounded-xl p-3 shadow-2xl backdrop-blur-md text-xs space-y-1.5 min-w-[140px]">
        <div className="font-semibold text-zinc-300 pb-1 border-b border-zinc-800">{label}</div>
        {payload.map((entry: any, index: number) => (
          <div key={`item-${index}`} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.stroke || entry.fill }} />
              <span>{entry.name}:</span>
            </span>
            <span className="font-mono font-bold text-zinc-100">
              {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export function AdminDashboardView({
  businesses,
  batches,
  logs,
  onNavigate,
  onSelectBusiness
}: AdminDashboardViewProps) {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');

  // Top Tier Hero KPIs
  const heroKpis = [
    {
      label: 'Total Businesses Ingested',
      value: '1,248,930',
      subtext: 'Path to 10M+ Enterprise Master Records',
      change: '+8.4%',
      isUp: true,
      icon: Building2,
      tab: 'records' as AdminTab,
      accentColor: 'from-blue-500/20 via-indigo-500/10 to-transparent',
      borderColor: 'group-hover:border-blue-500/40',
      iconBg: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      progressPercent: 12.5,
      progressLabel: '12.5% of 10M Target'
    },
    {
      label: 'Published to Live Discover',
      value: '1,180,450',
      subtext: '94.5% conversion through verification gate',
      change: '+9.1%',
      isUp: true,
      icon: CheckCircle2,
      tab: 'published' as AdminTab,
      accentColor: 'from-emerald-500/20 via-teal-500/10 to-transparent',
      borderColor: 'group-hover:border-emerald-500/40',
      iconBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      progressPercent: 94.5,
      progressLabel: '94.5% Publish Rate'
    },
    {
      label: 'Active Platform Subscribers',
      value: '1,480',
      subtext: '128 new business accounts this week',
      change: '+22.4%',
      isUp: true,
      icon: Users,
      tab: 'users' as AdminTab,
      accentColor: 'from-purple-500/20 via-pink-500/10 to-transparent',
      borderColor: 'group-hover:border-purple-500/40',
      iconBg: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      progressPercent: 74,
      progressLabel: '74% Pro Tier'
    },
    {
      label: 'Credits Economy & Revenue',
      value: '$142,500',
      subtext: '482k credits consumed for lead unlocks',
      change: '+18.9%',
      isUp: true,
      icon: CreditCard,
      tab: 'credits' as AdminTab,
      accentColor: 'from-amber-500/20 via-orange-500/10 to-transparent',
      borderColor: 'group-hover:border-amber-500/40',
      iconBg: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      progressPercent: 88,
      progressLabel: '88% Consumption Velocity'
    },
  ];

  // Secondary Pipeline KPIs
  const pipelineKpis = [
    { label: 'Pending Review', value: '42,310', change: '-4.2%', isUp: false, isWarning: false, icon: Clock, tab: 'records' as AdminTab, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
    { label: 'Draft Records', value: '18,290', change: '+12.0%', isUp: true, isWarning: false, icon: FileText, tab: 'records' as AdminTab, color: 'text-zinc-400', bg: 'bg-zinc-800/60 border-zinc-700/40' },
    { label: 'Duplicate Quarantined', value: '5,420', change: '-8.5%', isUp: false, isWarning: false, icon: CopyX, tab: 'duplicates' as AdminTab, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' },
    { label: 'Failed Imports', value: '12', change: '-50.0%', isUp: false, isWarning: true, icon: AlertTriangle, tab: 'history' as AdminTab, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20' },
    { label: "Today's Ingested Rows", value: '8,420', change: '+15.3%', isUp: true, isWarning: false, icon: UploadCloud, tab: 'import' as AdminTab, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
    { label: 'Recently Published', value: '2,150', change: '+6.8%', isUp: true, isWarning: false, icon: Sparkles, tab: 'published' as AdminTab, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  ];

  return (
    <div className="space-y-6 pb-12 text-zinc-100">
      
      {/* 1. Executive Hero KPIs (Top 4 Strategic Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {heroKpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigate(kpi.tab)}
              className={`group relative overflow-hidden rounded-2xl p-5 bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 border border-zinc-800/80 shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer ${kpi.borderColor}`}
            >
              {/* Subtle ambient light gradient */}
              <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${kpi.accentColor} blur-2xl pointer-events-none group-hover:scale-125 transition-transform duration-500`} />

              <div className="relative z-10 flex flex-col justify-between h-full space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-xs font-semibold text-zinc-400 tracking-wide block">{kpi.label}</span>
                    <div className="text-2xl sm:text-3xl font-bold font-mono tracking-tight text-white mt-1">
                      {kpi.value}
                    </div>
                  </div>
                  <div className={`p-2.5 rounded-xl border ${kpi.iconBg} shrink-0 transition-transform group-hover:scale-110 duration-200`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[11px] text-zinc-400 truncate max-w-[170px]">{kpi.subtext}</span>
                    <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-bold ${
                      kpi.isUp ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}>
                      {kpi.isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {kpi.change}
                    </span>
                  </div>

                  {/* Micro Progress Track */}
                  <div className="w-full bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
                    <div 
                      className="h-full rounded-full bg-gradient-to-r from-zinc-400 to-white transition-all duration-700" 
                      style={{ width: `${kpi.progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. Operational Pipeline KPIs (6 Clean Compact Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {pipelineKpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigate(kpi.tab)}
              className="group p-3.5 rounded-xl bg-zinc-900/70 hover:bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 transition-all duration-200 cursor-pointer flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-zinc-400 truncate pr-1">{kpi.label}</span>
                <div className={`p-1.5 rounded-lg border ${kpi.bg} ${kpi.color}`}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="flex items-baseline justify-between mt-1">
                <span className="text-lg font-bold font-mono tracking-tight text-zinc-100">{kpi.value}</span>
                <span className={`text-[10px] font-mono font-semibold inline-flex items-center ${
                  kpi.isUp ? 'text-emerald-400' : kpi.isWarning ? 'text-rose-400' : 'text-zinc-400'
                }`}>
                  {kpi.isUp ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {kpi.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* 3. Data Quality & Pipeline Health Bar */}
      <div className="p-5 rounded-2xl border border-zinc-800/90 bg-gradient-to-r from-zinc-900/90 via-zinc-900/60 to-zinc-950/90 shadow-xl backdrop-blur-md relative overflow-hidden">
        {/* Subtle accent line at top */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Automated Data Quality & Validation Telemetry
              </h2>
              <p className="text-[11px] text-zinc-400">Real-time schema conformance across continuous ingestion workers</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Engine Online • Zero Ingest Lag
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-zinc-800/60">
          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Validation Success</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
            </div>
            <div className="text-xl font-bold font-mono text-emerald-400">94.2%</div>
            <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: '94.2%' }} />
            </div>
            <span className="text-[10px] text-zinc-500 block">Schema compliant</span>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Duplicate Rate</span>
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
            </div>
            <div className="text-xl font-bold font-mono text-indigo-400">3.4%</div>
            <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: '3.4%' }} />
            </div>
            <span className="text-[10px] text-zinc-500 block">Auto-quarantined</span>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Approval Rate</span>
              <span className="w-2 h-2 rounded-full bg-teal-400" />
            </div>
            <div className="text-xl font-bold font-mono text-teal-400">88.5%</div>
            <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-teal-500 rounded-full" style={{ width: '88.5%' }} />
            </div>
            <span className="text-[10px] text-zinc-500 block">Passed review</span>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Flagged Violations</span>
              <span className="w-2 h-2 rounded-full bg-rose-400" />
            </div>
            <div className="text-xl font-bold font-mono text-rose-400">45</div>
            <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-rose-500 rounded-full" style={{ width: '15%' }} />
            </div>
            <span className="text-[10px] text-zinc-500 block">Requiring manual fix</span>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Avg Latency</span>
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
            </div>
            <div className="text-xl font-bold font-mono text-cyan-400">1.2s</div>
            <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full" style={{ width: '40%' }} />
            </div>
            <span className="text-[10px] text-zinc-500 block">Per batch row pipeline</span>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Published Today</span>
              <span className="w-2 h-2 rounded-full bg-amber-400" />
            </div>
            <div className="text-xl font-bold font-mono text-amber-400">2,150</div>
            <div className="w-full bg-zinc-800 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: '70%' }} />
            </div>
            <span className="text-[10px] text-zinc-500 block">Live in Discover search</span>
          </div>
        </div>
      </div>

      {/* 4. Row 1 of Charts: Ingestion vs Published & Batch Failure Rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chart 1: Smooth Area Ingestion Flow */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 p-5 shadow-xl backdrop-blur-md min-w-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">Ingested vs Published Throughput</h3>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">Daily record ingestion comparison across validation queues</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg p-0.5 bg-zinc-950 border border-zinc-800 text-[10px] font-medium text-zinc-400">
                <button 
                  onClick={() => setTimeRange('7d')}
                  className={`px-2 py-0.5 rounded-md transition ${timeRange === '7d' ? 'bg-zinc-800 text-white font-semibold' : 'hover:text-zinc-200'}`}
                >
                  7D
                </button>
                <button 
                  onClick={() => setTimeRange('30d')}
                  className={`px-2 py-0.5 rounded-md transition ${timeRange === '30d' ? 'bg-zinc-800 text-white font-semibold' : 'hover:text-zinc-200'}`}
                >
                  30D
                </button>
                <button 
                  onClick={() => setTimeRange('90d')}
                  className={`px-2 py-0.5 rounded-md transition ${timeRange === '90d' ? 'bg-zinc-800 text-white font-semibold' : 'hover:text-zinc-200'}`}
                >
                  90D
                </button>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                Avg: 5.3k/day
              </span>
            </div>
          </div>

          <div className="h-68 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ADDED_PER_DAY_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradientAdded" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gradientPublished" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272A" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  iconType="circle" 
                  wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                  formatter={(value) => <span className="text-zinc-300 font-medium mr-2">{value}</span>}
                />
                <Area 
                  type="monotone" 
                  name="Ingested Records" 
                  dataKey="added" 
                  stroke="#3B82F6" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#gradientAdded)" 
                />
                <Area 
                  type="monotone" 
                  name="Published to Discover" 
                  dataKey="published" 
                  stroke="#10B981" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#gradientPublished)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Batch Ingestion Volume & Failure Rate */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 p-5 shadow-xl backdrop-blur-md min-w-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
            <div>
              <div className="flex items-center gap-2">
                <BarChart className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">Batch Pipeline Volume & Error Rate</h3>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">Historical records processed through CSV / XLSX pipelines</p>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 self-start sm:self-auto">
              Total Ingested: 93.3k
            </span>
          </div>

          <div className="h-68 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={IMPORTS_PER_DAY_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272A" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  iconType="circle" 
                  wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                  formatter={(value) => <span className="text-zinc-300 font-medium mr-2">{value}</span>}
                />
                <Bar dataKey="total" name="Valid Ingests" fill="#6366F1" radius={[6, 6, 0, 0]} />
                <Bar dataKey="failed" name="Schema Rejections" fill="#F43F5E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* 5. Row 2 of Charts: Growth & Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Chart 3: Cumulative Growth Curve */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 p-5 shadow-xl backdrop-blur-md min-w-0 overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">Cumulative Database Growth</h3>
              </div>
              <p className="text-[11px] text-zinc-400">Progressive milestone to 10M entities</p>
            </div>
            <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
              1.25M Live
            </span>
          </div>

          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={BUSINESS_GROWTH_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradientGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272A" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#A1A1AA', fontSize: 11 }} />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#A1A1AA', fontSize: 10 }}
                  tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} 
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  name="Total Entities" 
                  dataKey="total" 
                  stroke="#10B981" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#gradientGrowth)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Industry Distribution Donut */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 p-5 shadow-xl backdrop-blur-md min-w-0 overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">Industry Breakdown</h3>
              </div>
              <p className="text-[11px] text-zinc-400">Verified entities across priority sectors</p>
            </div>
            <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-md">
              7 Sectors
            </span>
          </div>

          <div className="h-60 w-full min-w-0 relative flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={INDUSTRY_DATA}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {INDUSTRY_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="#18181B" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                  layout="horizontal" 
                  verticalAlign="bottom" 
                  align="center" 
                  iconType="circle" 
                  wrapperStyle={{ fontSize: '10px', paddingTop: '4px' }}
                  formatter={(value) => <span className="text-zinc-400">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Centered Donut Label */}
            <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <span className="text-[10px] uppercase font-bold text-zinc-500 block">Total</span>
              <span className="text-base font-bold font-mono text-white">1.25M</span>
            </div>
          </div>
        </div>

        {/* Chart 5: State Density Bars */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 p-5 shadow-xl backdrop-blur-md min-w-0 overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white tracking-tight">Top Indian Industrial Hubs</h3>
              </div>
              <p className="text-[11px] text-zinc-400">MSME registration density by state</p>
            </div>
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md">
              Top 6
            </span>
          </div>

          <div className="space-y-2.5 pt-1">
            {STATE_DISTRIBUTION_DATA.map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-300">{item.state}</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-zinc-100 font-bold">{item.count.toLocaleString()}</span>
                    <span className="text-[10px] text-zinc-500">({item.percentage})</span>
                  </div>
                </div>
                <div className="w-full bg-zinc-800/80 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" 
                    style={{ width: item.percentage }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* 6. Operational Feeds & System Health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Ingestions Batch List */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 shadow-xl overflow-hidden flex flex-col backdrop-blur-md">
          <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/40">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <UploadCloud className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Recent Ingestion Batches</h3>
            </div>
            <button
              onClick={() => onNavigate('history')}
              className="text-[11px] font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer transition"
            >
              <span>View All</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
            {batches.slice(0, 4).map((batch) => (
              <div key={batch.id} className="p-3.5 hover:bg-zinc-800/40 transition-colors text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-200 truncate max-w-[210px]">{batch.fileName}</span>
                  <span className="font-mono text-[10px] text-zinc-400 shrink-0">{batch.id}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>{batch.totalRecords.toLocaleString()} rows • {batch.fileSize}</span>
                  <span className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${
                    batch.status === 'Completed' 
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                      : batch.status === 'Processing'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}>
                    {batch.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recently Published Records */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 shadow-xl overflow-hidden flex flex-col backdrop-blur-md">
          <div className="p-4 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-950/40">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">Live Discover Entities</h3>
            </div>
            <button
              onClick={() => onNavigate('published')}
              className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition"
            >
              <span>View All</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
            {businesses.filter(b => b.status === 'published').slice(0, 4).map((b) => (
              <div
                key={b.id}
                onClick={() => onSelectBusiness(b)}
                className="p-3.5 hover:bg-zinc-800/40 transition-colors text-xs space-y-1.5 cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-zinc-200 truncate max-w-[210px]">{b.name}</span>
                  <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                    {b.opportunityScore} pts
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400">
                  <span>{b.industry} • {b.city}</span>
                  <span className="text-zinc-500">{b.updatedAt}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* System & Cluster Status */}
        <div className="bg-zinc-900/80 rounded-2xl border border-zinc-800/80 shadow-xl p-5 flex flex-col justify-between space-y-4 backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Enterprise Cluster Telemetry</h3>
                <span className="text-[10px] text-zinc-400">Postgres • Upstash Redis • Typesense</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              OPTIMAL
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70">
              <div className="flex items-center gap-2 text-zinc-300">
                <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                <span>Primary Postgres Shards</span>
              </div>
              <span className="font-mono font-bold text-emerald-400">99.99% Uptime</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70">
              <div className="flex items-center gap-2 text-zinc-300">
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                <span>Bulk Ingestion Throughput</span>
              </div>
              <span className="font-mono font-bold text-indigo-400">14,200 rec/s</span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/70">
              <div className="flex items-center gap-2 text-zinc-300">
                <Cpu className="w-3.5 h-3.5 text-purple-400" />
                <span>Elasticsearch Index Latency</span>
              </div>
              <span className="font-mono font-bold text-purple-400">18ms P95</span>
            </div>
          </div>

          <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/40 text-[11px] text-zinc-400 space-y-1">
            <div className="flex items-center justify-between font-semibold text-zinc-200">
              <span>Async Queue Health</span>
              <span className="text-emerald-400 font-mono">0 Stuck</span>
            </div>
            <p className="text-[10px] text-zinc-500">4 active background validation threads & Upstash BullMQ worker listening</p>
          </div>
        </div>

      </div>

    </div>
  );
}
