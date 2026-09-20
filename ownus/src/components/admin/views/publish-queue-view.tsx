'use client';

import React, { useState, useMemo } from 'react';
import { AdminBusinessRecord, BusinessStatus, ValidationStatus } from '@/types/admin';
import {
  Layers,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  Send,
  Trash2,
  Archive,
  ChevronLeft,
  ChevronRight,
  Eye,
  Check,
  X,
  MapPin,
  Building2,
  ShieldCheck,
  Sparkles,
  Download,
  SlidersHorizontal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DiscoverFilterState,
  initialFilterState
} from '@/components/discover/discover-filters';
import { QuickFilterChips } from '@/components/discover/quick-filter-chips';
import {
  filterAdminBusinessRecord,
  getAdminActiveFiltersCount
} from '@/lib/admin-filter-utils';
import { AdminActiveFilters } from '@/components/admin/admin-active-filters';
import { AdminFilterDrawer } from '@/components/admin/modals/admin-filter-drawer';

interface PublishQueueViewProps {
  records: AdminBusinessRecord[];
  onViewRecord: (record: AdminBusinessRecord) => void;
  onStatusChange: (id: string, newStatus: BusinessStatus) => void;
  onBulkStatusChange: (ids: string[], newStatus: BusinessStatus) => void;
  onBulkDelete: (ids: string[]) => void;
}

export function PublishQueueView({
  records,
  onViewRecord,
  onStatusChange,
  onBulkStatusChange,
  onBulkDelete,
}: PublishQueueViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApprovalStatus, setSelectedApprovalStatus] = useState<string>('all');
  const [selectedPublishStatus, setSelectedPublishStatus] = useState<string>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [selectedState, setSelectedState] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Full Customer Filter Parity State
  const [filters, setFilters] = useState<DiscoverFilterState>(initialFilterState);
  const [activeChips, setActiveChips] = useState<string[]>([]);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState<boolean>(false);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    return (
      getAdminActiveFiltersCount(filters, activeChips) +
      (selectedApprovalStatus !== 'all' ? 1 : 0) +
      (selectedPublishStatus !== 'all' ? 1 : 0)
    );
  }, [filters, activeChips, selectedApprovalStatus, selectedPublishStatus]);

  const handleToggleChip = (chipId: string) => {
    setActiveChips((prev) =>
      prev.includes(chipId) ? prev.filter((id) => id !== chipId) : [...prev, chipId]
    );
    setCurrentPage(1);
  };

  const handleResetFilters = () => {
    setFilters(initialFilterState);
    setActiveChips([]);
    setSelectedApprovalStatus('all');
    setSelectedPublishStatus('all');
    setSearchQuery('');
    setCurrentPage(1);
  };

  // Compute Queue Metrics
  const metrics = useMemo(() => {
    const total = records.length;
    const readyToPublish = records.filter(r => r.status === 'approved').length;
    const publishedLive = records.filter(r => r.status === 'published').length;
    const pendingApproval = records.filter(r => r.status === 'validated' || r.validationStatus === 'Pending').length;
    const drafts = records.filter(r => r.status === 'draft').length;
    const rejected = records.filter(r => r.status === 'rejected').length;
    return { total, readyToPublish, publishedLive, pendingApproval, drafts, rejected };
  }, [records]);

  // Extract industries & states
  const industries = useMemo(() => Array.from(new Set(records.map(r => r.industry))).sort(), [records]);
  const states = useMemo(() => Array.from(new Set(records.map(r => r.state))).sort(), [records]);

  // Filter queue with complete customer parity
  const filteredQueue = useMemo(() => {
    return records.filter((r) => {
      if (!filterAdminBusinessRecord(r, filters, searchQuery, activeChips, selectedPublishStatus)) {
        return false;
      }
      if (selectedApprovalStatus !== 'all' && r.validationStatus !== selectedApprovalStatus) {
        return false;
      }
      if (selectedState !== 'all' && r.state !== selectedState) {
        return false;
      }
      if (selectedIndustry !== 'all' && r.industry !== selectedIndustry) {
        return false;
      }
      return true;
    });
  }, [records, searchQuery, selectedApprovalStatus, selectedPublishStatus, selectedIndustry, selectedState, filters, activeChips]);

  // Pagination
  const totalPages = Math.ceil(filteredQueue.length / pageSize) || 1;
  const paginatedQueue = filteredQueue.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(paginatedQueue.map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const renderApprovalBadge = (status: ValidationStatus) => {
    return (
      <span className={cn(
        'px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider',
        status === 'Approved' && 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900',
        status === 'Validated' && 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700',
        status === 'Pending' && 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700',
        status === 'Rejected' && 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-bold',
        status === 'Warning' && 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold'
      )}>
        {status}
      </span>
    );
  };

  const renderPublishBadge = (status: BusinessStatus) => {
    switch (status) {
      case 'published':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Live
          </span>
        );
      case 'approved':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700">
            Ready to Publish
          </span>
        );
      case 'draft':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium uppercase bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
            Draft
          </span>
        );
      case 'archived':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium uppercase bg-zinc-100 dark:bg-zinc-800 text-zinc-400">
            Archived
          </span>
        );
      case 'rejected':
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
            Rejected
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium uppercase bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            {status}
          </span>
        );
    }
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Name', 'Industry', 'City', 'State', 'Validation Score', 'Approval Status', 'Reviewer', 'Approved Date', 'Publish Status'];
    const rows = filteredQueue.map(r => [
      r.id,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.industry}"`,
      `"${r.city}"`,
      `"${r.state}"`,
      r.validationScore,
      r.validationStatus,
      `"${r.reviewer || 'Unassigned'}"`,
      r.approvedDate || 'Pending',
      r.status
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `orion_publish_queue_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 pb-12 text-zinc-900 dark:text-zinc-100 text-xs">
      
      {/* Top Banner */}
      <div className="bg-white dark:bg-zinc-950 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
              Publish Queue & Approval Gate
            </h1>
            <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
              Discover Sync Gate
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Enforce the strict lifecycle: Draft ➔ Imported ➔ Validated ➔ Approved ➔ Published. Only published records appear to Discover users.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition cursor-pointer self-start md:self-auto"
        >
          <Download className="w-3.5 h-3.5" />
          Export Queue CSV
        </button>
      </div>

      {/* Lifecycle Flow Widget */}
      <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs">
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-2">
          
          <div className="flex-1 min-w-[140px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 text-center">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">1. Draft / Ingest</span>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">{metrics.drafts}</div>
            <span className="text-[10px] text-zinc-500">Unprocessed</span>
          </div>

          <span className="text-zinc-300 dark:text-zinc-700 font-bold">➔</span>

          <div className="flex-1 min-w-[140px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 text-center">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">2. Validated</span>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">{metrics.pendingApproval}</div>
            <span className="text-[10px] text-zinc-500">Schema Passed</span>
          </div>

          <span className="text-zinc-300 dark:text-zinc-700 font-bold">➔</span>

          <div className="flex-1 min-w-[140px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 text-center">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">3. Approved</span>
            <div className="text-xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-0.5">{metrics.readyToPublish}</div>
            <span className="text-[10px] text-zinc-500">Ready to Publish</span>
          </div>

          <span className="text-zinc-300 dark:text-zinc-700 font-bold">➔</span>

          <div className="flex-1 min-w-[140px] p-3 rounded-xl border border-zinc-900 dark:border-white bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-center shadow-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider block opacity-80">4. Published Live</span>
            <div className="text-xl font-bold font-mono mt-0.5">{metrics.publishedLive}</div>
            <span className="text-[10px] opacity-80">Active in Discover</span>
          </div>

        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 w-full md:w-auto flex-1 min-w-0">
            {/* Toggle Filters Button */}
            <button
              onClick={() => setIsFilterDrawerOpen(true)}
              className={cn(
                'px-3 py-2 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer',
                activeFiltersCount > 0
                  ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white shadow-xs'
                  : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              )}
              title="Open Advanced Filters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full ml-0.5 bg-white/20 text-white dark:bg-black/20 dark:text-zinc-900">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search queue by business name, city, ID..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto shrink-0">
            <select
              value={selectedPublishStatus}
              onChange={(e) => {
                setSelectedPublishStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none cursor-pointer"
            >
              <option value="all">All Publish States</option>
              <option value="approved">Ready to Publish (Approved)</option>
              <option value="published">Published (Live in Discover)</option>
              <option value="validated">Validated</option>
              <option value="draft">Draft</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
            </select>

            <select
              value={selectedApprovalStatus}
              onChange={(e) => {
                setSelectedApprovalStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none cursor-pointer"
            >
              <option value="all">All Approval States</option>
              <option value="Approved">Approved</option>
              <option value="Pending">Pending Review</option>
              <option value="Rejected">Rejected</option>
              <option value="Warning">Warning</option>
            </select>
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

      {/* Admin Filter Drawer for Publish Queue */}
      <AdminFilterDrawer
        isOpen={isFilterDrawerOpen}
        onClose={() => setIsFilterDrawerOpen(false)}
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setCurrentPage(1);
        }}
        onReset={handleResetFilters}
        activeFiltersCount={activeFiltersCount}
        totalFilteredCount={filteredQueue.length}
        title="Publish Queue Filter Constraints"
      />

      {/* Bulk Action Bar */}
      {selectedIds.length > 0 && (
        <div className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-5 py-3 rounded-xl shadow-lg flex items-center justify-between animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 font-semibold">
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 dark:bg-zinc-200 text-xs font-mono">
              {selectedIds.length} Selected
            </span>
            <span>Batch Queue Actions:</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onBulkStatusChange(selectedIds, 'published');
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-200 dark:hover:bg-zinc-300 text-xs font-bold rounded-lg transition cursor-pointer"
            >
              Publish Selected
            </button>
            <button
              onClick={() => {
                onBulkStatusChange(selectedIds, 'approved');
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-200 dark:hover:bg-zinc-300 text-xs font-bold rounded-lg transition cursor-pointer"
            >
              Approve Selected
            </button>
            <button
              onClick={() => {
                onBulkStatusChange(selectedIds, 'archived');
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-200 dark:hover:bg-zinc-300 text-xs font-bold rounded-lg transition cursor-pointer"
            >
              Archive Selected
            </button>
            <button
              onClick={() => {
                onBulkDelete(selectedIds);
                setSelectedIds([]);
              }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-200 dark:hover:bg-zinc-300 text-xs font-bold rounded-lg transition cursor-pointer"
            >
              Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* Queue Table */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-zinc-900/80 text-zinc-500 uppercase text-[10px] font-bold border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3.5 w-10 text-center">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={paginatedQueue.length > 0 && selectedIds.length === paginatedQueue.length}
                    className="w-4 h-4 rounded accent-zinc-900 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3.5">Business Name & Category</th>
                <th className="px-4 py-3.5">Industry Sector</th>
                <th className="px-4 py-3.5">Location</th>
                <th className="px-4 py-3.5 text-center">Validation Score</th>
                <th className="px-4 py-3.5 text-center">Approval Status</th>
                <th className="px-4 py-3.5">Reviewer & Approval Date</th>
                <th className="px-4 py-3.5 text-center">Publish Status</th>
                <th className="px-4 py-3.5 text-right">Publish Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {paginatedQueue.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-zinc-500">
                    <Layers className="w-8 h-8 mx-auto mb-2 text-zinc-400" />
                    No records found in the publish queue matching the filters.
                  </td>
                </tr>
              ) : (
                paginatedQueue.map((record) => {
                  const isSelected = selectedIds.includes(record.id);
                  return (
                    <tr
                      key={record.id}
                      className={cn(
                        'hover:bg-zinc-50/60 dark:hover:bg-zinc-900/40 transition-colors',
                        isSelected && 'bg-zinc-50 dark:bg-zinc-900/60'
                      )}
                    >
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(record.id)}
                          className="w-4 h-4 rounded accent-zinc-900 cursor-pointer"
                        />
                      </td>

                      <td className="px-4 py-3">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs flex items-center gap-1.5">
                          {record.name}
                        </div>
                        <span className="text-[10px] text-zinc-400 font-mono">{record.id} • {record.category}</span>
                      </td>

                      <td className="px-4 py-3 text-zinc-800 dark:text-zinc-200 font-medium">
                        {record.industry}
                      </td>

                      <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-zinc-400" />
                          {record.city}, {record.state}
                        </div>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
                          {record.validationScore}%
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center">
                        {renderApprovalBadge(record.validationStatus)}
                      </td>

                      <td className="px-4 py-3 text-zinc-500 font-mono text-[11px]">
                        <div className="text-zinc-800 dark:text-zinc-200 font-sans font-medium">{record.reviewer || 'Unassigned'}</div>
                        <div className="text-[10px] text-zinc-400">{record.approvedDate || 'Pending review'}</div>
                      </td>

                      <td className="px-4 py-3 text-center">
                        {renderPublishBadge(record.status)}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onViewRecord(record)}
                            title="Inspect Details"
                            className="p-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {record.status !== 'published' ? (
                            <button
                              onClick={() => onStatusChange(record.id, 'published')}
                              className="px-2.5 py-1 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-[11px] font-bold rounded-lg hover:opacity-90 transition cursor-pointer"
                              title="Publish Record to Discover"
                            >
                              Publish
                            </button>
                          ) : (
                            <button
                              onClick={() => onStatusChange(record.id, 'approved')}
                              className="px-2.5 py-1 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-[11px] font-semibold rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                              title="Unpublish (Return to Approved Queue)"
                            >
                              Unpublish
                            </button>
                          )}

                          <button
                            onClick={() => onStatusChange(record.id, 'draft')}
                            title="Move back to Draft"
                            className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onStatusChange(record.id, 'archived')}
                            title="Archive Record"
                            className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-center justify-between text-xs text-zinc-500">
          <div>
            Showing <span className="font-bold text-zinc-900 dark:text-zinc-100">{(currentPage - 1) * pageSize + 1}</span> to{' '}
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              {Math.min(currentPage * pageSize, filteredQueue.length)}
            </span>{' '}
            of <span className="font-bold text-zinc-900 dark:text-zinc-100">{filteredQueue.length}</span> records
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-3 font-mono font-bold text-zinc-900 dark:text-zinc-100">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
