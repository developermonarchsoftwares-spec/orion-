'use client';
import { Linkedin } from '@/components/ui/linkedin-icon';

import React, { useState, useMemo } from 'react';
import { AdminBusinessRecord, BusinessStatus, ValidationStatus } from '@/types/admin';
import {
  Search,
  Filter,
  Download,
  Check,
  X,
  Trash2,
  Archive,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Layers,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Tag,
  ShieldCheck,
  AlertCircle,
  RotateCcw,
  Sliders
} from 'lucide-react';
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

interface BusinessRecordsViewProps {
  businesses: AdminBusinessRecord[];
  onSelectBusiness: (business: AdminBusinessRecord) => void;
  onUpdateStatus: (id: string, status: BusinessStatus) => void;
  onBulkUpdateStatus: (ids: string[], status: BusinessStatus) => void;
  onBulkDelete: (ids: string[]) => void;
  onExportRecords: (records: AdminBusinessRecord[]) => void;
}

export function BusinessRecordsView({
  businesses,
  onSelectBusiness,
  onUpdateStatus,
  onBulkUpdateStatus,
  onBulkDelete,
  onExportRecords,
}: BusinessRecordsViewProps) {
  // Search & Filter State (Full Parity with Customer Discover Portal)
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<DiscoverFilterState>(initialFilterState);
  const [activeChips, setActiveChips] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedValidationStatus, setSelectedValidationStatus] = useState<string>('all');

  // View & Sorting Controls
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [sortField, setSortField] = useState<'updatedAt' | 'opportunityScore' | 'name' | 'registrationDate' | 'dataQualityScore'>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Calculate total active filter constraints
  const activeFiltersCount = useMemo(() => {
    return (
      getAdminActiveFiltersCount(filters, activeChips) +
      (selectedStatus !== 'all' ? 1 : 0) +
      (selectedValidationStatus !== 'all' ? 1 : 0)
    );
  }, [filters, selectedStatus, selectedValidationStatus, activeChips]);

  // Handle Quick Filter Chip toggling
  const handleToggleChip = (chipId: string) => {
    setActiveChips((prev) =>
      prev.includes(chipId) ? prev.filter((id) => id !== chipId) : [...prev, chipId]
    );
    setCurrentPage(1);
  };

  // Reset all filters
  const handleResetFilters = () => {
    setFilters(initialFilterState);
    setActiveChips([]);
    setSelectedStatus('all');
    setSelectedValidationStatus('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Comprehensive Real-Time Filtering matching Customer Discover Engine
  const filtered = useMemo(() => {
    return businesses
      .filter((b) => {
        if (!filterAdminBusinessRecord(b, filters, searchQuery, activeChips, selectedStatus)) {
          return false;
        }
        if (selectedValidationStatus !== 'all' && b.validationStatus !== selectedValidationStatus) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        let aVal: any = a[sortField];
        let bVal: any = b[sortField];

        if (sortField === 'opportunityScore' || sortField === 'dataQualityScore') {
          const numA = Number(aVal) || 0;
          const numB = Number(bVal) || 0;
          return sortOrder === 'asc' ? numA - numB : numB - numA;
        }

        if (sortField === 'registrationDate' || sortField === 'updatedAt') {
          const timeA = aVal ? new Date(aVal).getTime() : 0;
          const timeB = bVal ? new Date(bVal).getTime() : 0;
          return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
        }

        return sortOrder === 'asc'
          ? String(aVal || '').localeCompare(String(bVal || ''))
          : String(bVal || '').localeCompare(String(aVal || ''));
      });
  }, [businesses, searchQuery, selectedStatus, selectedValidationStatus, filters, activeChips, sortField, sortOrder]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSelectAll = () => {
    if (selectedIds.length === paginated.length && paginated.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginated.map((b) => b.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((i) => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const getStatusBadge = (status: BusinessStatus) => {
    switch (status) {
      case 'published':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 uppercase">
            Published
          </span>
        );
      case 'approved':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 uppercase">
            Approved
          </span>
        );
      case 'validated':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 uppercase">
            Validated
          </span>
        );
      case 'draft':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 uppercase">
            Draft
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 uppercase line-through">
            Rejected
          </span>
        );
      case 'archived':
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600 uppercase">
            Archived
          </span>
        );
    }
  };

  return (
    <div className="space-y-4 pb-12 text-zinc-900 dark:text-zinc-100">
      {/* Top Header & Search Controls Toolbar */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Left: Search bar + Toggle Filters Button */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {/* Toggle Filter Sidebar Button */}
            <button
              onClick={() => setSidebarOpen((prev) => !prev)}
              className={cn(
                'px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer',
                sidebarOpen
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white shadow-xs'
                  : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              )}
              title="Toggle Comprehensive Filters Sidebar"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span
                  className={cn(
                    'px-1.5 py-0.2 text-[10px] font-bold rounded-full ml-0.5',
                    sidebarOpen
                      ? 'bg-white/20 text-white dark:bg-black/20 dark:text-zinc-900'
                      : 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  )}
                >
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Global Search Input */}
            <div className="relative flex-1 min-w-[240px] max-w-xl">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search name, phone, email, city, pincode, state or ID..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-hidden text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Right: Status Filter, Sorting & Export */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Admin Operational Status Dropdown */}
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer"
            >
              <option value="all">All Statuses ({businesses.length})</option>
              <option value="published">Published</option>
              <option value="approved">Approved</option>
              <option value="validated">Validated</option>
              <option value="draft">Draft</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
            </select>

            {/* Validation Status Filter */}
            <select
              value={selectedValidationStatus}
              onChange={(e) => {
                setSelectedValidationStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer"
            >
              <option value="all">All Validation</option>
              <option value="Approved">Approved</option>
              <option value="Validated">Validated</option>
              <option value="Pending">Pending</option>
              <option value="Warning">Warning</option>
              <option value="Rejected">Rejected</option>
            </select>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2.5 py-1.5 rounded-lg text-xs">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
              <select
                value={`${sortField}_${sortOrder}`}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'score_desc') {
                    setSortField('opportunityScore');
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
                  } else if (val === 'date_desc') {
                    setSortField('registrationDate');
                    setSortOrder('desc');
                  }
                }}
                className="bg-transparent font-medium text-zinc-800 dark:text-zinc-200 focus:outline-hidden cursor-pointer"
              >
                <option value="updated_desc">Recently Updated</option>
                <option value="score_desc">Highest Quality Score</option>
                <option value="date_desc">Newest Incorporated</option>
                <option value="name_asc">Name (A - Z)</option>
                <option value="name_desc">Name (Z - A)</option>
              </select>
            </div>

            {/* Export CSV */}
            <button
              onClick={() => onExportRecords(filtered)}
              className="px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV ({filtered.length})</span>
            </button>
          </div>
        </div>

        {/* Quick Filter Chips Bar */}
        <div className="pt-1 border-t border-zinc-100 dark:border-zinc-900">
          <QuickFilterChips activeChips={activeChips} onToggleChip={handleToggleChip} />
        </div>

        {/* Active Filter Tags Row */}
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

        {/* Bulk Actions Toolbar */}
        {selectedIds.length > 0 && (
          <div className="p-2.5 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg flex items-center justify-between flex-wrap gap-2 text-xs animate-in fade-in-50">
            <div className="flex items-center gap-2 font-semibold">
              <span className="bg-white/20 dark:bg-black/20 px-2 py-0.5 rounded font-mono">
                {selectedIds.length} records selected
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => {
                  onBulkUpdateStatus(selectedIds, 'published');
                  setSelectedIds([]);
                }}
                className="px-2.5 py-1 rounded bg-white text-zinc-900 dark:bg-zinc-900 dark:text-white font-bold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Publish</span>
              </button>
              <button
                onClick={() => {
                  onBulkUpdateStatus(selectedIds, 'approved');
                  setSelectedIds([]);
                }}
                className="px-2.5 py-1 rounded bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 font-semibold transition-colors cursor-pointer"
              >
                Approve
              </button>
              <button
                onClick={() => {
                  onBulkUpdateStatus(selectedIds, 'rejected');
                  setSelectedIds([]);
                }}
                className="px-2.5 py-1 rounded bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 font-semibold transition-colors cursor-pointer"
              >
                Reject
              </button>
              <button
                onClick={() => {
                  onBulkUpdateStatus(selectedIds, 'draft');
                  setSelectedIds([]);
                }}
                className="px-2.5 py-1 rounded bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 font-semibold transition-colors cursor-pointer"
              >
                Draft
              </button>
              <button
                onClick={() => {
                  onBulkDelete(selectedIds);
                  setSelectedIds([]);
                }}
                className="px-2.5 py-1 rounded bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 font-semibold text-white dark:text-zinc-900 transition-colors cursor-pointer flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                onClick={() => setSelectedIds([])}
                className="px-2 py-1 rounded text-zinc-300 dark:text-zinc-600 hover:text-white dark:hover:text-black font-medium"
              >
                Deselect
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Workspace Layout: Left Collapsible Filter Sidebar + Right Enterprise Data Table */}
      <div className="flex items-start gap-4">
        {/* Left Filter Sidebar (Identical to Customer Portal DiscoverFilters) */}
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

        {/* Right Data Table Workspace */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                {/* Sticky Table Header */}
                <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-500 uppercase tracking-wider sticky top-0 z-10 select-none">
                  <tr>
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === paginated.length && paginated.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5 cursor-pointer"
                      />
                    </th>
                    <th className="p-3 min-w-[220px]">Business Name</th>
                    <th className="p-3 min-w-[170px]">Industry & Sub-Sector</th>
                    <th className="p-3 min-w-[140px]">Location (State/City)</th>
                    <th className="p-3 min-w-[120px]">Phone Number</th>
                    <th className="p-3 min-w-[110px]">Website Status</th>
                    <th className="p-3 w-28 text-center">Status</th>
                    <th className="p-3 w-20 text-center">Score</th>
                    <th className="p-3 w-24 text-right">Actions</th>
                  </tr>
                </thead>

                {/* Table Rows */}
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {paginated.length > 0 ? (
                    paginated.map((b) => {
                      const isSelected = selectedIds.includes(b.id);
                      return (
                        <tr
                          key={b.id}
                          className={cn(
                            'hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group cursor-pointer',
                            isSelected && 'bg-zinc-100/60 dark:bg-zinc-900/80'
                          )}
                          onClick={() => onSelectBusiness(b)}
                        >
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(b.id)}
                              className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5 cursor-pointer"
                            />
                          </td>

                          {/* Business Name */}
                          <td className="p-3">
                            <div className="font-bold text-zinc-900 dark:text-zinc-100 group-hover:underline truncate max-w-[220px]">
                              {b.name}
                            </div>
                            <div className="text-[10px] font-mono text-zinc-400 mt-0.5">{b.id}</div>
                          </td>

                          {/* Industry & Sub-Industry */}
                          <td className="p-3">
                            <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[170px]">
                              {b.industry}
                            </div>
                            <div className="text-[10px] text-zinc-500 dark:text-zinc-400 truncate max-w-[170px]">
                              {b.subIndustry || b.category || 'General Enterprise'}
                            </div>
                          </td>

                          {/* Location */}
                          <td className="p-3">
                            <div className="font-medium text-zinc-800 dark:text-zinc-200">
                              {b.city}, {b.state}
                            </div>
                            <div className="text-[10px] font-mono text-zinc-400">{b.pincode}</div>
                          </td>

                          {/* Phone & Contacts */}
                          <td className="p-3 font-mono font-medium text-zinc-700 dark:text-zinc-300">
                            <div>{b.phone || <span className="text-zinc-400 italic">No Phone</span>}</div>
                            {(b.linkedin || (b as any).linkedin_url || (b as any).linkedInUrl) && (
                              <div className="text-[10px] text-[#0A66C2] flex items-center gap-1 truncate max-w-[120px] mt-0.5 font-sans">
                                <Linkedin className="w-3 h-3" />
                                <span>LinkedIn</span>
                              </div>
                            )}
                          </td>

                          {/* Website */}
                          <td className="p-3">
                            {b.hasWebsite ? (
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-800 dark:text-zinc-200">
                                <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
                                <span className="truncate max-w-[100px]">{b.website.replace('https://', '')}</span>
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-400 italic">No Website</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="p-3 text-center">{getStatusBadge(b.status)}</td>

                          {/* Score */}
                          <td className="p-3 text-center">
                            <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">
                              {b.opportunityScore || b.dataQualityScore || 75}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => onSelectBusiness(b)}
                              className="px-2.5 py-1 rounded-md text-[11px] font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 transition-colors"
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="p-12 text-center text-zinc-500">
                        <div className="max-w-sm mx-auto space-y-2">
                          <p className="font-semibold text-sm">No business records matching criteria.</p>
                          <p className="text-xs text-zinc-400">
                            Try adjusting your search terms, changing location or industry filters, or resetting filter constraints.
                          </p>
                          <button
                            onClick={handleResetFilters}
                            className="mt-2 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset All Filters</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer with Pagination & Result Counts */}
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="text-zinc-500 font-medium">
                Showing{' '}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {filtered.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {Math.min(currentPage * pageSize, filtered.length)}
                </span>{' '}
                of{' '}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {filtered.length.toLocaleString()}
                </span>{' '}
                filtered records
                {activeFiltersCount > 0 && (
                  <span className="ml-1 text-zinc-400 font-normal">
                    (filtered from {businesses.length.toLocaleString()} total)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {/* Page Size Selector */}
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
                    <option value={100}>100</option>
                  </select>
                </div>

                {/* Page Navigation */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-mono font-semibold px-2">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
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
}
