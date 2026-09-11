'use client';

import React, { useState, useMemo } from 'react';
import { 
  Globe, 
  Search, 
  Filter, 
  Download, 
  ExternalLink, 
  Eye, 
  RotateCcw, 
  CheckCircle2, 
  MapPin, 
  Phone, 
  Mail, 
  Building2, 
  Sparkles,
  ArrowUpDown,
  MoreVertical,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import { AdminBusinessRecord } from '@/types/admin';

interface PublishedBusinessesViewProps {
  records: AdminBusinessRecord[];
  onViewRecord: (record: AdminBusinessRecord) => void;
  onStatusChange: (id: string, newStatus: AdminBusinessRecord['status']) => void;
}

export const PublishedBusinessesView: React.FC<PublishedBusinessesViewProps> = ({
  records,
  onViewRecord,
  onStatusChange,
}) => {
  const publishedRecords = useMemo(() => {
    return records.filter(r => r.status === 'published');
  }, [records]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedState, setSelectedState] = useState('ALL');
  const [selectedIndustry, setSelectedIndustry] = useState('ALL');
  const [sortField, setSortField] = useState<'name' | 'dataQualityScore' | 'updatedAt'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const industries = useMemo(() => {
    const set = new Set(publishedRecords.map(r => r.industry));
    return Array.from(set);
  }, [publishedRecords]);

  const states = useMemo(() => {
    const set = new Set(publishedRecords.map(r => r.state));
    return Array.from(set);
  }, [publishedRecords]);

  const filteredRecords = useMemo(() => {
    return publishedRecords.filter(r => {
      const matchesSearch = 
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.phone.includes(searchQuery) ||
        r.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesState = selectedState === 'ALL' || r.state === selectedState;
      const matchesIndustry = selectedIndustry === 'ALL' || r.industry === selectedIndustry;

      return matchesSearch && matchesState && matchesIndustry;
    }).sort((a, b) => {
      let aVal = a[sortField] || '';
      let bVal = b[sortField] || '';
      if (sortField === 'dataQualityScore') {
        return sortOrder === 'asc' ? (a.dataQualityScore - b.dataQualityScore) : (b.dataQualityScore - a.dataQualityScore);
      }
      return sortOrder === 'asc' 
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [publishedRecords, searchQuery, selectedState, selectedIndustry, sortField, sortOrder]);

  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'Industry', 'Category', 'City', 'State', 'Phone', 'Email', 'Website', 'Quality Score', 'Published At'];
    const rows = filteredRecords.map(r => [
      r.id,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.industry}"`,
      `"${r.category}"`,
      `"${r.city}"`,
      `"${r.state}"`,
      r.phone,
      r.email,
      r.website,
      r.dataQualityScore,
      r.updatedAt
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `orion_published_businesses_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header Info Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <Globe className="w-5 h-5 text-zinc-300" />
              Published Businesses Directory
            </h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
              Live in Discover
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            These verified records are actively indexed, queryable, and visible to all Orion users in the Discover portal.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition"
          >
            <Download className="w-4 h-4" />
            Export Live Records ({filteredRecords.length})
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Live Discover Records</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{publishedRecords.length.toLocaleString()}</div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> 100% Discover Index Synchronized
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Average Quality Score</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">
            {publishedRecords.length ? Math.round(publishedRecords.reduce((acc, r) => acc + r.dataQualityScore, 0) / publishedRecords.length) : 0}%
          </div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-300" /> Zero critical schema violations
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">High Opportunity Index</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">
            {publishedRecords.filter(r => r.opportunityScore >= 80).length}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            High-converting agency leads
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Indexed States</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{states.length}</div>
          <div className="text-xs text-zinc-400 mt-1">Across Indian territories</div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by name, phone, email, city..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <select
            value={selectedIndustry}
            onChange={e => setSelectedIndustry(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Industries ({industries.length})</option>
            {industries.map(ind => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>

          <select
            value={selectedState}
            onChange={e => setSelectedState(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All States ({states.length})</option>
            {states.map(st => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>

          <select
            value={sortField}
            onChange={e => setSortField(e.target.value as any)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="updatedAt">Sort by Published Date</option>
            <option value="dataQualityScore">Sort by Quality Score</option>
            <option value="name">Sort by Business Name</option>
          </select>

          <button
            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
            title="Toggle sort order"
            className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Business Name & Category</th>
                <th className="py-3.5 px-4">Location</th>
                <th className="py-3.5 px-4">Contact Info</th>
                <th className="py-3.5 px-4 text-center">Quality</th>
                <th className="py-3.5 px-4 text-center">Lead Score</th>
                <th className="py-3.5 px-4">Published Date</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500 font-sans">
                    <Globe className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No published records match the active criteria.
                  </td>
                </tr>
              ) : (
                filteredRecords.map(record => (
                  <tr key={record.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-semibold text-zinc-100 text-sm flex items-center gap-1.5">
                        {record.name}
                        {record.hasWebsite && (
                          <span title="Has Website" className="inline-block w-2 h-2 rounded-full bg-zinc-400"></span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1">
                        <Building2 className="w-3 h-3 text-zinc-500" />
                        {record.industry} • {record.category}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <div className="text-zinc-200 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-zinc-400" />
                        {record.city}, {record.state}
                      </div>
                      <div className="text-xs text-zinc-500">{record.pincode}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <div className="text-zinc-300 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-zinc-400" />
                        {record.phone}
                      </div>
                      {record.email && (
                        <div className="text-xs text-zinc-400 flex items-center gap-1 truncate max-w-[180px]">
                          <Mail className="w-3 h-3 text-zinc-500" />
                          {record.email}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-center font-sans">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">
                        {record.dataQualityScore}%
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-center font-sans">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {record.opportunityScore}/100
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-zinc-400 font-sans text-xs">
                      {new Date(record.updatedAt).toLocaleDateString()}
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => onViewRecord(record)}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                          title="Inspect record profile"
                        >
                          View
                        </button>
                        <button
                          onClick={() => onStatusChange(record.id, 'approved')}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                          title="Unpublish (Return to Approved queue)"
                        >
                          Unpublish
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
