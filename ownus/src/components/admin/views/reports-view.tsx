'use client';

import React, { useState } from 'react';
import { 
  BarChart3, 
  Download, 
  TrendingUp, 
  Building2, 
  CheckCircle2, 
  AlertTriangle, 
  Calendar,
  Sparkles,
  Users,
  CreditCard,
  Layers,
  ShieldAlert,
  FileSpreadsheet,
  FileText,
  CopyX,
  PieChart as PieChartIcon,
  MapPin,
  ArrowUpRight,
  Activity,
  DollarSign
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  LineChart, 
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend
} from 'recharts';
import { AdminBusinessRecord } from '@/types/admin';

interface ReportsViewProps {
  records: AdminBusinessRecord[];
}

// 8 Chart Datasets
const BUSINESSES_ADDED_OVER_TIME = [
  { month: 'Apr', added: 42000, published: 38500 },
  { month: 'May', added: 61000, published: 54000 },
  { month: 'Jun', added: 84000, published: 76000 },
  { month: 'Jul', added: 98000, published: 89000 },
  { month: 'Aug', added: 115000, published: 104000 },
  { month: 'Sep', added: 124500, published: 112000 },
];

const USERS_GROWTH_DATA = [
  { month: 'Apr', totalUsers: 4800, newUsers: 850 },
  { month: 'May', totalUsers: 6400, newUsers: 1200 },
  { month: 'Jun', totalUsers: 8200, newUsers: 1450 },
  { month: 'Jul', totalUsers: 10100, newUsers: 1620 },
  { month: 'Aug', totalUsers: 11900, newUsers: 1540 },
  { month: 'Sep', totalUsers: 12850, newUsers: 640 },
];

const CREDITS_PURCHASED_DATA = [
  { month: 'Apr', credits: 450000 },
  { month: 'May', credits: 780000 },
  { month: 'Jun', credits: 1120000 },
  { month: 'Jul', credits: 1450000 },
  { month: 'Aug', credits: 1680000 },
  { month: 'Sep', credits: 1840000 },
];

const REVENUE_GROWTH_DATA = [
  { month: 'Apr', revenueLakhs: 36.5 },
  { month: 'May', revenueLakhs: 58.2 },
  { month: 'Jun', revenueLakhs: 84.0 },
  { month: 'Jul', revenueLakhs: 112.5 },
  { month: 'Aug', revenueLakhs: 134.0 },
  { month: 'Sep', revenueLakhs: 148.5 },
];

const INDUSTRY_DISTRIBUTION_DATA = [
  { name: 'Manufacturing & Heavy Engineering', share: 32, count: 398000, fill: '#3b82f6' },
  { name: 'IT & Software Development', share: 24, count: 298000, fill: '#10b981' },
  { name: 'Logistics, Supply & Warehousing', share: 18, count: 224000, fill: '#8b5cf6' },
  { name: 'Healthcare & Pharma', share: 14, count: 174000, fill: '#f59e0b' },
  { name: 'Textiles & Garments', share: 8, count: 99000, fill: '#06b6d4' },
  { name: 'Others', share: 4, count: 55500, fill: '#71717a' },
];

const STATE_DISTRIBUTION_DATA = [
  { state: 'Maharashtra', count: 342000 },
  { state: 'Karnataka', count: 284000 },
  { state: 'Tamil Nadu', count: 241000 },
  { state: 'Gujarat', count: 218000 },
  { state: 'Telangana', count: 186000 },
  { state: 'Delhi NCR', count: 145000 },
  { state: 'Haryana', count: 98000 },
];

const CATEGORY_DISTRIBUTION_DATA = [
  { name: 'CNC Precision Machining', value: 35, fill: '#3b82f6' },
  { name: 'Cloud ERP & CRM Systems', value: 25, fill: '#10b981' },
  { name: 'Cold Storage & Logistics', value: 18, fill: '#8b5cf6' },
  { name: 'Diagnostic Pharma', value: 14, fill: '#f59e0b' },
  { name: 'Synthetic Weaving', value: 8, fill: '#06b6d4' },
];

const MAU_ENGAGEMENT_DATA = [
  { month: 'Apr', mau: 3200 },
  { month: 'May', mau: 4800 },
  { month: 'Jun', mau: 6700 },
  { month: 'Jul', mau: 8900 },
  { month: 'Aug', mau: 10400 },
  { month: 'Sep', mau: 11250 },
];

// Top Lists
const TOP_INDUSTRIES = [
  { rank: 1, name: 'Manufacturing & Industrial Supplies', records: '398,000', growth: '+24%' },
  { rank: 2, name: 'IT & Software Development', records: '298,000', growth: '+18%' },
  { rank: 3, name: 'Logistics, Warehousing & Supply', records: '224,000', growth: '+15%' },
  { rank: 4, name: 'Healthcare, Medical & Pharma', records: '174,000', growth: '+12%' },
];

const TOP_STATES = [
  { rank: 1, name: 'Maharashtra', records: '342,000', verifiedRate: '94.2%' },
  { rank: 2, name: 'Karnataka', records: '284,000', verifiedRate: '92.8%' },
  { rank: 3, name: 'Tamil Nadu', records: '241,000', verifiedRate: '91.5%' },
  { rank: 4, name: 'Gujarat', records: '218,000', verifiedRate: '89.4%' },
];

const TOP_DISTRICTS = [
  { rank: 1, district: 'Bengaluru Urban', state: 'Karnataka', records: '142,500' },
  { rank: 2, district: 'Pune', state: 'Maharashtra', records: '128,400' },
  { rank: 3, district: 'Mumbai Suburban', state: 'Maharashtra', records: '115,200' },
  { rank: 4, district: 'Hyderabad', state: 'Telangana', records: '98,600' },
];

const MOST_SEARCHED_CATEGORIES = [
  { category: 'Precision CNC Turning & Milling', queries: '48,200' },
  { category: 'Enterprise Cloud ERP Solutions', queries: '34,100' },
  { category: 'Cold Chain Pharmaceutical Logistics', queries: '28,900' },
  { category: 'Active Pharmaceutical Ingredients (API)', queries: '21,400' },
];

const MOST_VIEWED_BUSINESSES = [
  { name: 'Apex Forge & CNC Works', city: 'Pune', views: '14,800', unlocks: '840' },
  { name: 'Bharat Industrial Logistics Ltd', city: 'Navi Mumbai', views: '12,400', unlocks: '690' },
  { name: 'Zenith BioPharm Labs India', city: 'Bengaluru', views: '10,900', unlocks: '620' },
  { name: 'Nova Cloud ERP Systems', city: 'Bengaluru', views: '9,450', unlocks: '510' },
];

const MOST_PURCHASED_CREDIT_PACKS = [
  { pack: 'Growth Pack (2,000 Credits)', unitsSold: '1,420 packs', revenue: '₹2.69 Cr' },
  { pack: 'Scale Pack (5,000 Credits)', unitsSold: '890 packs', revenue: '₹4.00 Cr' },
  { pack: 'Starter Pack (500 Credits)', unitsSold: '2,150 packs', revenue: '₹1.07 Cr' },
  { pack: 'Enterprise Pool (10,000+ Credits)', unitsSold: '340 packs', revenue: '₹2.71 Cr' },
];

const TOP_CUSTOMERS = [
  { name: 'Aarav Singhania', company: 'Apex Digital Solutions', spend: '₹1,48,500', unlocks: '840 leads' },
  { name: 'Meera Nambiar', company: 'Cochin Spice & Agri', spend: '₹92,000', unlocks: '520 leads' },
  { name: 'Neha Deshmukh', company: 'FinTrack Tech LLP', spend: '₹49,990', unlocks: '310 leads' },
  { name: 'Karan Malhotra', company: 'Malhotra Fasteners', spend: '₹38,990', unlocks: '220 leads' },
];

export const ReportsView: React.FC<ReportsViewProps> = ({ records }) => {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | '1y'>('30d');
  const [activeTab, setActiveTab] = useState<'analytics' | 'top_lists'>('analytics');
  const [showExportModal, setShowExportModal] = useState(false);

  const handleExport = (format: 'csv' | 'excel' | 'pdf') => {
    const reportData = {
      title: 'Orion Platform Executive Analytics Summary',
      generatedAt: new Date().toISOString(),
      format,
      timeRange,
      kpis: {
        totalBusinesses: '1,248,500',
        publishedBusinesses: '1,120,400',
        addedToday: '3,840',
        addedThisMonth: '124,500',
        activeUsers: '12,850',
        newRegistrations: '640',
        creditsSold: '1,840,000',
        revenue: '₹1,48,50,000',
        pendingValidations: '14,200',
        pendingApprovals: '3,150',
        duplicateRate: '3.2%',
        dataQualityScore: '91.8%'
      }
    };

    if (format === 'csv') {
      const headers = ['Metric', 'Value'];
      const rows = Object.entries(reportData.kpis).map(([k, v]) => [k, `"${v}"`]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `orion_platform_analytics_${timeRange}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orion_executive_report_${timeRange}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    setShowExportModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-zinc-300" />
            Platform Executive Reports & Intelligence
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Complete platform observability: 12 key performance indicators, ingestion growth, revenue, credit velocity, and top-tier distributions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-1">
            {(['7d', '30d', '90d', '1y'] as const).map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition ${
                  timeRange === range
                    ? 'bg-zinc-800 text-zinc-100 shadow'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {range.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow"
          >
            <Download className="w-4 h-4" />
            Export Report
          </button>
        </div>
      </div>

      {/* 12 KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3.5">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Total Businesses</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">1,248,500</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <Building2 className="w-3 h-3 text-zinc-300" /> In Master DB
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Published Businesses</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">1,120,400</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <CheckCircle2 className="w-3 h-3 text-zinc-300" /> Live in Discover
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Added Today</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">+3,840</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <ArrowUpRight className="w-3 h-3 text-zinc-300" /> Pipeline intake
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Added This Month</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">+124,500</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            +18.2% vs last mo
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Active Users</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">12,850</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <Users className="w-3 h-3 text-zinc-300" /> 30-day active
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">New Registrations</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">+640</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            +12% this week
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Credits Sold</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">1,840,000</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <CreditCard className="w-3 h-3 text-zinc-300" /> Issued to wallets
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Revenue</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">₹1.48 Cr</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            +22.4% MoM
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Pending Validations</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">14,200</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <ShieldAlert className="w-3 h-3 text-zinc-300" /> In curation queue
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Pending Approvals</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">3,150</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <Layers className="w-3 h-3 text-zinc-300" /> Awaiting review
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Duplicate Rate</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">3.2%</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            -0.6% improvement
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Data Quality Score</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">91.8%</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            Schema verified
          </div>
        </div>
      </div>

      {/* Tab Navigation: Analytics Charts vs Top Lists */}
      <div className="flex border-b border-zinc-800 gap-2">
        <button
          onClick={() => setActiveTab('analytics')}
          className={`pb-3 px-4 text-sm font-medium border-b-2 transition flex items-center gap-2 ${
            activeTab === 'analytics'
              ? 'border-zinc-200 text-zinc-100 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Growth & Analytics (8 Charts)
        </button>

        <button
          onClick={() => setActiveTab('top_lists')}
          className={`pb-3 px-4 text-sm font-medium border-b-2 transition flex items-center gap-2 ${
            activeTab === 'top_lists'
              ? 'border-zinc-200 text-zinc-100 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <TrendingUp className="w-4 h-4" />
          Top Lists & Category Intelligence (7 Lists)
        </button>
      </div>

      {/* Tab 1: 8 Responsive Charts */}
      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Businesses Added Over Time */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">1. Businesses Added Over Time</h2>
                <p className="text-xs text-zinc-400">Monthly intake vs approved publication records</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={BUSINESSES_ADDED_OVER_TIME} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="added" name="Ingested Records" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="published" name="Published Live" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Users Growth */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">2. Users Growth Trajectory</h2>
                <p className="text-xs text-zinc-400">Total registered subscriber base & monthly acquisition</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={USERS_GROWTH_DATA} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Area type="monotone" dataKey="totalUsers" name="Total Users" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 3: Credits Purchased */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">3. Credits Purchased Volume</h2>
                <p className="text-xs text-zinc-400">Total credit units minted and purchased across enterprise packs</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={CREDITS_PURCHASED_DATA} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Bar dataKey="credits" name="Credits Sold" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: Revenue Growth */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">4. Revenue Growth (₹ Lakhs)</h2>
                <p className="text-xs text-zinc-400">Gross platform recurring and one-off credit pack earnings</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={REVENUE_GROWTH_DATA} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} unit="L" />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Line type="monotone" dataKey="revenueLakhs" name="Revenue (₹ Lakhs)" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 5: Industry Distribution */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">5. Industry Sector Distribution</h2>
                <p className="text-xs text-zinc-400">Share of verified businesses across macro industries</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={INDUSTRY_DISTRIBUTION_DATA} layout="vertical" margin={{ top: 5, right: 20, left: 35, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" stroke="#71717a" fontSize={11} tickLine={false} unit="%" />
                  <YAxis dataKey="name" type="category" stroke="#71717a" fontSize={10} tickLine={false} width={130} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Bar dataKey="share" name="Market Share %" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 6: State Distribution */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">6. State-Level Geographic Density</h2>
                <p className="text-xs text-zinc-400">Commercial entity volume across top Indian states</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={STATE_DISTRIBUTION_DATA} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="state" stroke="#71717a" fontSize={10} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Bar dataKey="count" name="Verified Businesses" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 7: Business Category Distribution */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">7. Business Category Breakdown</h2>
                <p className="text-xs text-zinc-400">Proportional share across top niche business categories</p>
              </div>
            </div>
            <div className="h-64 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={CATEGORY_DISTRIBUTION_DATA}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {CATEGORY_DISTRIBUTION_DATA.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 8: Monthly Active Users */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">8. Monthly Active Users (MAU)</h2>
                <p className="text-xs text-zinc-400">Discover search & lead unlock activity per active subscriber</p>
              </div>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MAU_ENGAGEMENT_DATA} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="month" stroke="#71717a" fontSize={11} tickLine={false} />
                  <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#f4f4f5' }} />
                  <Area type="monotone" dataKey="mau" name="Monthly Active Users" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 7 Top Lists */}
      {activeTab === 'top_lists' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* List 1: Top Industries */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Top Industries</span>
              <span className="text-[10px] text-zinc-400 font-mono">By Volume</span>
            </h2>
            <div className="space-y-2">
              {TOP_INDUSTRIES.map(item => (
                <div key={item.rank} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-800 text-zinc-200 font-bold flex items-center justify-center text-[10px] font-mono">
                      #{item.rank}
                    </span>
                    <span className="font-semibold text-zinc-200">{item.name}</span>
                  </div>
                  <span className="font-mono text-zinc-400">{item.records}</span>
                </div>
              ))}
            </div>
          </div>

          {/* List 2: Top States */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Top States</span>
              <span className="text-[10px] text-zinc-400 font-mono">Verified Ratio</span>
            </h2>
            <div className="space-y-2">
              {TOP_STATES.map(item => (
                <div key={item.rank} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-800 text-zinc-200 font-bold flex items-center justify-center text-[10px] font-mono">
                      #{item.rank}
                    </span>
                    <span className="font-semibold text-zinc-200">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-zinc-200">{item.records}</div>
                    <div className="text-[10px] text-zinc-400 font-mono">{item.verifiedRate} valid</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* List 3: Top Districts */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Top Districts</span>
              <span className="text-[10px] text-zinc-400 font-mono">Commercial Hubs</span>
            </h2>
            <div className="space-y-2">
              {TOP_DISTRICTS.map(item => (
                <div key={item.rank} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-800 text-zinc-200 font-bold flex items-center justify-center text-[10px] font-mono">
                      #{item.rank}
                    </span>
                    <div>
                      <div className="font-semibold text-zinc-200">{item.district}</div>
                      <div className="text-[10px] text-zinc-400">{item.state}</div>
                    </div>
                  </div>
                  <span className="font-mono text-zinc-400">{item.records}</span>
                </div>
              ))}
            </div>
          </div>

          {/* List 4: Most Searched Categories */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Most Searched Categories</span>
              <span className="text-[10px] text-zinc-400 font-mono">Monthly Queries</span>
            </h2>
            <div className="space-y-2">
              {MOST_SEARCHED_CATEGORIES.map(item => (
                <div key={item.category} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-200">{item.category}</span>
                  <span className="font-mono text-zinc-400">{item.queries} searches</span>
                </div>
              ))}
            </div>
          </div>

          {/* List 5: Most Viewed Businesses */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Most Viewed Businesses</span>
              <span className="text-[10px] text-zinc-400 font-mono">Impressions / Unlocks</span>
            </h2>
            <div className="space-y-2">
              {MOST_VIEWED_BUSINESSES.map(item => (
                <div key={item.name} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-zinc-200">{item.name}</div>
                    <div className="text-[10px] text-zinc-400">{item.city}</div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="text-zinc-200">{item.views} views</div>
                    <div className="text-[10px] text-zinc-400">{item.unlocks} unlocks</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* List 6: Most Purchased Credit Packs */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Most Purchased Credit Packs</span>
              <span className="text-[10px] text-zinc-400 font-mono">Revenue</span>
            </h2>
            <div className="space-y-2">
              {MOST_PURCHASED_CREDIT_PACKS.map(item => (
                <div key={item.pack} className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <div className="font-semibold text-zinc-200">{item.pack}</div>
                    <div className="text-[10px] text-zinc-400">{item.unitsSold}</div>
                  </div>
                  <span className="font-mono font-bold text-zinc-200">{item.revenue}</span>
                </div>
              ))}
            </div>
          </div>

          {/* List 7: Top Customers */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3 md:col-span-2 lg:col-span-3">
            <h2 className="text-sm font-bold text-zinc-100 flex items-center justify-between">
              <span>Top Enterprise Customers</span>
              <span className="text-[10px] text-zinc-400 font-mono">Lifetime Spend</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {TOP_CUSTOMERS.map(item => (
                <div key={item.name} className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs space-y-1">
                  <div className="font-bold text-zinc-100">{item.name}</div>
                  <div className="text-zinc-400">{item.company}</div>
                  <div className="pt-2 flex justify-between items-center border-t border-zinc-800/60 font-mono">
                    <span className="text-zinc-200 font-bold">{item.spend}</span>
                    <span className="text-zinc-400">{item.unlocks}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Export Format Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <Download className="w-5 h-5 text-zinc-300" />
                Export Reports Summary
              </h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Choose the export format for the current executive analytics summary ({timeRange.toUpperCase()} time range).
            </p>

            <div className="space-y-2.5">
              <button
                onClick={() => handleExport('csv')}
                className="w-full p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-semibold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-400" />
                  <span>CSV Spreadsheet Format</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">.csv</span>
              </button>

              <button
                onClick={() => handleExport('excel')}
                className="w-full p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-semibold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-zinc-400" />
                  <span>Microsoft Excel Workbook</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">.xlsx</span>
              </button>

              <button
                onClick={() => handleExport('pdf')}
                className="w-full p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-semibold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-zinc-400" />
                  <span>Executive PDF Report</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">.pdf</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
