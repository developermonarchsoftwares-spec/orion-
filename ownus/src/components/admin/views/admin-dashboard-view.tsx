'use client';

import React from 'react';
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
  ArrowRight
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
  { name: 'Manufacturing', value: 28 },
  { name: 'Services & B2B', value: 22 },
  { name: 'Healthcare & Pharma', value: 16 },
  { name: 'Renewable Energy', value: 12 },
  { name: 'Packaging & Logistics', value: 10 },
  { name: 'Food & Agro Processing', value: 8 },
  { name: 'Other Sectors', value: 4 },
];

const STATE_DISTRIBUTION_DATA = [
  { state: 'Maharashtra', count: 342000 },
  { state: 'Karnataka', count: 285000 },
  { state: 'Tamil Nadu', count: 210000 },
  { state: 'Gujarat', count: 189000 },
  { state: 'Telangana', count: 124000 },
  { state: 'Delhi NCR', count: 98000 },
];

const CHART_COLORS = ['#2563EB', '#059669', '#D97706', '#9333EA', '#06B6D4', '#E11D48', '#EA580C'];

export function AdminDashboardView({
  businesses,
  batches,
  logs,
  onNavigate,
  onSelectBusiness
}: AdminDashboardViewProps) {

  const kpis = [
    { label: 'Total Businesses', value: '1,248,930', change: '+8.4%', isUp: true, icon: Building2, tab: 'records' as AdminTab },
    { label: 'Published Businesses', value: '1,180,450', change: '+9.1%', isUp: true, icon: CheckCircle2, tab: 'published' as AdminTab },
    { label: 'Pending Review', value: '42,310', change: '-4.2%', isUp: false, icon: Clock, tab: 'records' as AdminTab },
    { label: 'Draft Records', value: '18,290', change: '+12.0%', isUp: true, icon: FileText, tab: 'records' as AdminTab },
    { label: 'Duplicate Records', value: '5,420', change: '-8.5%', isUp: false, icon: CopyX, tab: 'duplicates' as AdminTab },
    { label: 'Failed Imports', value: '12', change: '-50.0%', isUp: false, icon: AlertTriangle, tab: 'history' as AdminTab },
    { label: 'Today\'s Imports', value: '8,420', change: '+15.3%', isUp: true, icon: UploadCloud, tab: 'import' as AdminTab },
    { label: 'Recently Published', value: '2,150', change: '+6.8%', isUp: true, icon: Sparkles, tab: 'published' as AdminTab },
    { label: 'Active Users', value: '1,480', change: '+22.4%', isUp: true, icon: Users, tab: 'users' as AdminTab },
    { label: 'Credits Purchased', value: '$142,500', change: '+18.9%', isUp: true, icon: CreditCard, tab: 'credits' as AdminTab },
  ];

  return (
    <div className="space-y-6 pb-12 text-zinc-900 dark:text-zinc-100">
      
      {/* 10 KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigate(kpi.tab)}
              className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs hover:border-zinc-400 dark:hover:border-zinc-600 transition-all cursor-pointer flex flex-col justify-between"
            >
              <div className="flex items-center justify-between text-zinc-500 mb-2">
                <span className="text-xs font-medium truncate pr-1">{kpi.label}</span>
                <div className="p-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className="flex items-baseline justify-between mt-1">
                <span className="text-xl font-bold font-mono tracking-tight text-zinc-900 dark:text-zinc-100">{kpi.value}</span>
                <span className={`text-[10px] font-mono font-semibold flex items-center ${kpi.isUp ? 'text-zinc-900 dark:text-zinc-100 font-bold' : 'text-zinc-500'}`}>
                  {kpi.isUp ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                  {kpi.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Module 2: Data Quality Management Performance Strip */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-zinc-900 dark:bg-white animate-pulse" />
            <span className="font-bold text-xs uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
              Data Quality & Validation Health (Module 2)
            </span>
          </div>
          <span className="text-[11px] font-mono text-zinc-500">
            Automated Quality Engine • Real-time
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <div className="p-2.5 rounded-lg bg-zinc-50/70 dark:bg-zinc-900/40">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Validation Success</span>
            <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">94.2%</div>
            <span className="text-[10px] text-zinc-500">Schema compliant</span>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50/70 dark:bg-zinc-900/40">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Duplicate Rate</span>
            <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">3.4%</div>
            <span className="text-[10px] text-zinc-500">Auto-quarantined</span>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50/70 dark:bg-zinc-900/40">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Approval Rate</span>
            <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">88.5%</div>
            <span className="text-[10px] text-zinc-500">Passed review</span>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50/70 dark:bg-zinc-900/40">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Rejected Records</span>
            <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">45</div>
            <span className="text-[10px] text-zinc-500">Flagged violations</span>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50/70 dark:bg-zinc-900/40">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Avg Validation Time</span>
            <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">1.2s</div>
            <span className="text-[10px] text-zinc-500">Per batch row</span>
          </div>

          <div className="p-2.5 rounded-lg bg-zinc-50/70 dark:bg-zinc-900/40">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Published Today</span>
            <div className="text-lg font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">2,150</div>
            <span className="text-[10px] text-zinc-500">Live in Discover</span>
          </div>
        </div>
      </div>

      {/* Row 1 of Charts: Added Per Day & Imports Per Day */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chart 1: Businesses Added Per Day */}
        <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 min-w-0 overflow-hidden shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Businesses Ingested vs Published (This Week)</h3>
              <p className="text-[11px] text-zinc-500">Daily verification throughput across workers</p>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
              Avg: 5.3k/day
            </span>
          </div>

          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ADDED_PER_DAY_DATA} margin={{ top: 5, right: 15, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#52525B20" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #3F3F46', background: '#18181B', color: '#FAFAFA', fontSize: '12px' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Line type="monotone" name="Ingested Records" dataKey="added" stroke="#2563EB" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                <Line type="monotone" name="Published to Discover" dataKey="published" stroke="#059669" strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Imports Per Day */}
        <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 min-w-0 overflow-hidden shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Batch Ingestion Volume & Failure Rate</h3>
              <p className="text-[11px] text-zinc-500">Historical records processed through CSV / XLSX pipelines</p>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
              Total: 93.3k
            </span>
          </div>

          <div className="h-64 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={IMPORTS_PER_DAY_DATA} margin={{ top: 5, right: 15, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#52525B20" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #3F3F46', background: '#18181B', color: '#FAFAFA', fontSize: '12px' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Bar dataKey="total" name="Valid Ingests" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="failed" name="Validation Errors" fill="#E11D48" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Row 2 of Charts: Growth & Distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Chart 3: Business Growth Cumulative */}
        <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 min-w-0 overflow-hidden shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Cumulative Database Growth</h3>
              <p className="text-[11px] text-zinc-500">Path to 10M+ records</p>
            </div>
            <span className="font-mono text-xs font-bold text-zinc-900 dark:text-white">1.25M</span>
          </div>
          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={BUSINESS_GROWTH_DATA} margin={{ top: 5, right: 15, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#52525B20" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #3F3F46', background: '#18181B', color: '#FAFAFA', fontSize: '12px' }} />
                <Area type="monotone" name="Total Records" dataKey="total" stroke="#059669" fill="#05966933" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 4: Industry Distribution */}
        <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 min-w-0 overflow-hidden shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Industry Distribution</h3>
              <p className="text-[11px] text-zinc-500">Verified entities by sector</p>
            </div>
            <span className="text-[11px] text-zinc-500">7 Sectors</span>
          </div>
          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={INDUSTRY_DATA}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={78}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {INDUSTRY_DATA.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #3F3F46', background: '#18181B', color: '#FAFAFA', fontSize: '12px' }} />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '6px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 5: State Distribution */}
        <div className="bg-white dark:bg-zinc-950 p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 min-w-0 overflow-hidden shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Top Indian States</h3>
              <p className="text-[11px] text-zinc-500">Density of registered commercial MSMEs</p>
            </div>
            <span className="text-[11px] text-zinc-500">Top 6</span>
          </div>
          <div className="h-60 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={STATE_DISTRIBUTION_DATA} layout="vertical" margin={{ top: 5, right: 15, left: 15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#52525B20" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 10 }} />
                <YAxis dataKey="state" type="category" axisLine={false} tickLine={false} tick={{ fill: '#71717A', fontSize: 10 }} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #3F3F46', background: '#18181B', color: '#FAFAFA', fontSize: '12px' }} />
                <Bar dataKey="count" name="Businesses" fill="#9333EA" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Row 3: Operational Feeds & Pipeline Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Recent Ingestions Batch List */}
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/30">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-zinc-500" />
              <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Recent Ingestion Batches</h3>
            </div>
            <button
              onClick={() => onNavigate('history')}
              className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <span>View All</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80 max-h-80 overflow-y-auto">
            {batches.slice(0, 4).map((batch) => (
              <div key={batch.id} className="p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">{batch.fileName}</span>
                  <span className="font-mono text-[10px] text-zinc-400">{batch.id}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{batch.totalRecords.toLocaleString()} rows • {batch.fileSize}</span>
                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                    {batch.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recently Published Records */}
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/30">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-zinc-500" />
              <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Live Published Records</h3>
            </div>
            <button
              onClick={() => onNavigate('published')}
              className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <span>View All</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="divide-y divide-zinc-100 dark:divide-zinc-800/80 max-h-80 overflow-y-auto">
            {businesses.filter(b => b.status === 'published').slice(0, 4).map((b) => (
              <div
                key={b.id}
                onClick={() => onSelectBusiness(b)}
                className="p-3.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors text-xs space-y-1 cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">{b.name}</span>
                  <span className="font-mono text-[10px] font-bold text-zinc-700 dark:text-zinc-300">{b.opportunityScore} pts</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{b.industry} • {b.city}</span>
                  <span>{b.updatedAt}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* System & Cluster Status */}
        <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-4 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-zinc-900 dark:text-white" />
              <h3 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Data Platform Cluster Health</h3>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-900 dark:text-white">
              <span className="h-2 w-2 rounded-full bg-zinc-900 dark:bg-zinc-100 animate-ping" />
              OPTIMAL
            </span>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <HardDrive className="w-3.5 h-3.5" />
                <span>Primary Postgres Shards</span>
              </div>
              <span className="font-mono font-bold text-zinc-900 dark:text-white">99.99% Uptime</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <Activity className="w-3.5 h-3.5" />
                <span>Ingestion Ingestion Rate</span>
              </div>
              <span className="font-mono font-bold text-zinc-900 dark:text-white">14,200 rec/s</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <Cpu className="w-3.5 h-3.5" />
                <span>Elasticsearch Index Latency</span>
              </div>
              <span className="font-mono font-bold text-zinc-900 dark:text-white">18ms</span>
            </div>
          </div>

          <div className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/40 text-[11px] text-zinc-500 space-y-1">
            <span className="font-bold text-zinc-900 dark:text-zinc-100 block">Queue Status:</span>
            <p>0 stuck ingestion workers • 4 active background validation threads</p>
          </div>
        </div>

      </div>

    </div>
  );
}
