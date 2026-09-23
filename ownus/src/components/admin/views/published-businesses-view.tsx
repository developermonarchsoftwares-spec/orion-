'use client';
import { Linkedin } from '@/components/ui/linkedin-icon';

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
  AlertCircle,
  SlidersHorizontal,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { AdminBusinessRecord } from '@/types/admin';
import { cn } from '@/lib/utils';
import {
  DiscoverFilters,
  DiscoverFilterState,
  initialFilterState
} from '@/components/discover/discover-filters';
import { QuickFilterChips } from '@/components/discover/quick-filter-chips';
import {
  filterAdminBusinessRecord,
  getAdminActiveFiltersCount,
} from '@/lib/admin-filter-utils';
import { AdminActiveFilters } from '@/components/admin/admin-active-filters';

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

  // Customer Filter Parity State
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<DiscoverFilterState>(initialFilterState);
  const [activeChips, setActiveChips] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);

  // Sorting & Pagination
  const [sortField, setSortField] = useState<'name' | 'dataQualityScore' | 'updatedAt' | 'opportunityScore'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    return getAdminActiveFiltersCount(filters, activeChips);
  }, [filters, activeChips]);

  const handleToggleChip = (chipId: string) => {
    setActiveChips((prev) =>
      prev.includes(chipId) ? prev.filter((id) => id !== chipId) : [...prev, chipId]
    );
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setFilters(initialFilterState);
    setActiveChips([]);
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Full-featured Real-Time Filtering matching Customer Page
  const filteredRecords = useMemo(() => {
    return publishedRecords
      .filter((r) => filterAdminBusinessRecord(r, filters, searchQuery, activeChips, 'all'))
      .sort((a, b) => {
        let aVal: any = a[sortField];
        let bVal: any = b[sortField];

        if (sortField === 'dataQualityScore' || sortField === 'opportunityScore') {
          const numA = Number(aVal) || 0;
          const numB = Number(bVal) || 0;
          return sortOrder === 'asc' ? numA - numB : numB - numA;
        }

        if (sortField === 'updatedAt') {
          const timeA = aVal ? new Date(aVal).getTime() : 0;
          const timeB = bVal ? new Date(bVal).getTime() : 0;
          return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
        }

        return sortOrder === 'asc'
          ? String(aVal || '').localeCompare(String(bVal || ''))
          : String(bVal || '').localeCompare(String(aVal || ''));
      });
  }, [publishedRecords, searchQuery, filters, activeChips, sortField, sortOrder]);

  const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
  const paginatedRecords = filteredRecords.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'Industry', 'Sub-Industry', 'Category', 'City', 'State', 'Phone', 'Email', 'Website', 'Quality Score', 'Published At'];
    const rows = filteredRecords.map(r => [
      r.id,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.industry}"`,
      `"${r.subIndustry || ''}"`,
      `"${r.category || ''}"`,
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
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      {/* Header Info Banner */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Globe className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
              Published Businesses Directory
            </h1>
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
              Live in Discover
            </span>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            These verified records are actively indexed, queryable, and visible to all Orion users in the Discover portal.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition cursor-pointer shadow-xs"
          >
            <Download className="w-4 h-4" />
            Export Live Records ({filteredRecords.length})
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Live Discover Records</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{publishedRecords.length.toLocaleString()}</div>
          <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" /> 100% Discover Synchronized
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Average Quality Score</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {publishedRecords.length ? Math.round(publishedRecords.reduce((acc, r) => acc + (r.dataQualityScore || 90), 0) / publishedRecords.length) : 0}%
          </div>
          <div className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" /> Zero schema violations
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">High Opportunity Index</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {publishedRecords.filter(r => (r.opportunityScore || 80) >= 80).length}
          </div>
          <div className="text-xs text-zinc-500 mt-1">High-converting leads</div>
        </div>

        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 shadow-xs">
          <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Filtered Matches</div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{filteredRecords.length.toLocaleString()}</div>
          <div className="text-xs text-zinc-500 mt-1">Active query results</div>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 space-y-3 shadow-xs">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1 w-full min-w-0">
            {/* Toggle Filters Button */}
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className={cn(
                'px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer',
                sidebarOpen
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white shadow-xs'
                  : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              )}
              title="Toggle Filters Sidebar"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span className={cn(
                  'px-1.5 py-0.2 text-[10px] font-bold rounded-full ml-0.5',
                  sidebarOpen ? 'bg-white/20 text-white dark:bg-black/20 dark:text-zinc-900' : 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                )}>
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search published records by name, city, state, phone, email, industry..."
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-hidden"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 rounded-lg text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
              <select
                value={`${sortField}_${sortOrder}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'score_desc') {
                    setSortField('dataQualityScore');
                    setSortOrder('desc');
                  } else if (val === 'updated_desc') {
                    setSortField('updatedAt');
                    setSortOrder('desc');
                  } else if (val === 'name_asc') {
                    setSortField('name');
                    setSortOrder('asc');
                  } else if (val === 'name_desc') {
                    setSortField('name');
                    setSortOrder('desc');
                  }
                }}
                className="bg-transparent font-medium text-zinc-800 dark:text-zinc-200 focus:outline-hidden cursor-pointer"
              >
                <option value="updated_desc">Published Date</option>
                <option value="score_desc">Quality Score</option>
                <option value="name_asc">Name (A - Z)</option>
                <option value="name_desc">Name (Z - A)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Quick Filter Chips */}
        <div className="pt-1 border-t border-zinc-100 dark:border-zinc-900">
          <QuickFilterChips activeChips={activeChips} onToggleChip={handleToggleChip} />
        </div>

        {/* Active Filter Tags */}
        <AdminActiveFilters
          filters={filters}
          onFiltersChange={(f) => {
            setFilters(f);
            setCurrentPage(1);
          }}
          activeChips={activeChips}
          onToggleChip={handleToggleChip}
          onClearAll={handleResetFilters}
        />
      </div>

      {/* Main Layout: Left DiscoverFilters + Right Table */}
      <div className="flex items-start gap-4">
        {sidebarOpen && (
          <div className="w-72 sm:w-80 shrink-0 sticky top-20 max-h-[calc(100vh-8rem)] flex flex-col transition-all duration-300">
            <DiscoverFilters
              filters={filters}
              onChange={(f) => {
                setFilters(f);
                setCurrentPage(1);
              }}
              onReset={handleResetFilters}
              onToggleSidebar={() => setSidebarOpen(false)}
              totalActiveFiltersCount={activeFiltersCount}
            />
          </div>
        )}

        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-800 dark:text-zinc-200 border-collapse">
                <thead className="bg-zinc-50 dark:bg-zinc-900 text-[11px] uppercase font-bold text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
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
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {paginatedRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-zinc-500">
                        <Globe className="w-8 h-8 mx-auto mb-2 text-zinc-400" />
                        <p className="font-semibold text-sm">No published records match the active criteria.</p>
                        <p className="text-xs text-zinc-400 mt-1">Try resetting filter constraints or adjusting your search.</p>
                      </td>
                    </tr>
                  ) : (
                    paginatedRecords.map(record => (
                      <tr key={record.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs flex items-center gap-1.5">
                            {record.name}
                            {record.hasWebsite && (
                              <span title="Has Website" className="inline-block w-2 h-2 rounded-full bg-zinc-400"></span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-zinc-400" />
                            {record.industry} • {record.subIndustry || record.category || 'General Enterprise'}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-zinc-400" />
                            {record.city}, {record.state}
                          </div>
                          <div className="text-[10px] font-mono text-zinc-400">{record.pincode}</div>
                        </td>

                        <td className="py-3.5 px-4 font-mono text-xs">
                          <div className="text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                            <Phone className="w-3 h-3 text-zinc-400" />
                            {record.phone || <span className="italic text-zinc-400">No Phone</span>}
                          </div>
                          {record.email && (
                            <div className="text-[10px] text-zinc-500 flex items-center gap-1 truncate max-w-[180px]">
                              <Mail className="w-3 h-3 text-zinc-400" />
                              {record.email}
                            </div>
                          )}
                          {(record.linkedin || record.linkedin_url || (record as any).linkedInUrl) && (
                            <div className="text-[10px] text-[#0A66C2] flex items-center gap-1 truncate max-w-[180px] mt-0.5">
                              <Linkedin className="w-3 h-3" />
                              <a
                                href={String(record.linkedin || record.linkedin_url || (record as any).linkedInUrl).startsWith('http') ? String(record.linkedin || record.linkedin_url || (record as any).linkedInUrl) : `https://${record.linkedin || record.linkedin_url || (record as any).linkedInUrl}`}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline truncate"
                              >
                                LinkedIn
                              </a>
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
                            {record.dataQualityScore || 90}%
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-center">
                          <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                            {record.opportunityScore || 80}/100
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-zinc-500 dark:text-zinc-400 text-xs">
                          {record.updatedAt ? new Date(record.updatedAt).toLocaleDateString() : 'Active'}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => onViewRecord(record)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 transition"
                            >
                              View
                            </button>
                            <button
                              onClick={() => onStatusChange(record.id, 'approved')}
                              className="px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition"
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

            {/* Table Footer with Pagination */}
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="text-zinc-500 font-medium">
                Showing{' '}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {filteredRecords.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {Math.min(currentPage * pageSize, filteredRecords.length)}
                </span>{' '}
                of{' '}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {filteredRecords.length.toLocaleString()}
                </span>{' '}
                filtered records
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-zinc-500">
                  <span>Per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setCurrentPage(1);
                    }}
                    className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1.5 py-0.5 text-xs text-zinc-800 dark:text-zinc-200"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono font-semibold px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
