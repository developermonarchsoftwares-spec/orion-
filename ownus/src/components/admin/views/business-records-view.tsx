'use client';

import React, { useState } from 'react';
import { AdminBusinessRecord, BusinessStatus } from '@/types/admin';
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
  Globe
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  onExportRecords
}: BusinessRecordsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedState, setSelectedState] = useState<string>('all');
  const [selectedIndustry, setSelectedIndustry] = useState<string>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Filter options
  const states = Array.from(new Set(businesses.map(b => b.state))).sort();
  const industries = Array.from(new Set(businesses.map(b => b.industry))).sort();

  const filtered = businesses.filter(b => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matches = 
        b.name.toLowerCase().includes(q) ||
        b.phone.toLowerCase().includes(q) ||
        b.city.toLowerCase().includes(q) ||
        b.pincode.includes(q) ||
        b.email.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q);
      if (!matches) return false;
    }
    if (selectedStatus !== 'all' && b.status !== selectedStatus) return false;
    if (selectedState !== 'all' && b.state !== selectedState) return false;
    if (selectedIndustry !== 'all' && b.industry !== selectedIndustry) return false;
    return true;
  });

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSelectAll = () => {
    if (selectedIds.length === paginated.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginated.map(b => b.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const getStatusBadge = (status: BusinessStatus) => {
    switch (status) {
      case 'published':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 uppercase">Published</span>;
      case 'approved':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 uppercase">Approved</span>;
      case 'validated':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 uppercase">Validated</span>;
      case 'draft':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 uppercase">Draft</span>;
      case 'rejected':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 uppercase line-through">Rejected</span>;
      case 'archived':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600 uppercase">Archived</span>;
    }
  };

  return (
    <div className="space-y-4 pb-12 text-zinc-900 dark:text-zinc-100">
      
      {/* Search & Filter Controls Toolbar */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          
          {/* Search bar */}
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search records by name, phone, email, city, pincode or ID..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-hidden text-zinc-900 dark:text-zinc-100"
            />
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer"
            >
              <option value="all">All Statuses ({businesses.length})</option>
              <option value="published">Published</option>
              <option value="approved">Approved</option>
              <option value="validated">Validated</option>
              <option value="draft">Draft</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
            </select>

            {/* State Filter */}
            <select
              value={selectedState}
              onChange={(e) => {
                setSelectedState(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer"
            >
              <option value="all">All States</option>
              {states.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            {/* Industry Filter */}
            <select
              value={selectedIndustry}
              onChange={(e) => {
                setSelectedIndustry(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer"
            >
              <option value="all">All Industries</option>
              {industries.map(ind => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>

            {/* Export */}
            <button
              onClick={() => onExportRecords(filtered)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Bulk Action Bar (Visible when rows selected) */}
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
                className="px-2.5 py-1 rounded bg-white/10 dark:bg-black/10 hover:bg-white/20 dark:hover:bg-black/20 font-semibold text-rose-300 dark:text-rose-700 transition-colors cursor-pointer flex items-center gap-1"
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

      {/* Enterprise Data Table */}
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
                <th className="p-3 min-w-[150px]">Industry & Category</th>
                <th className="p-3 min-w-[140px]">Location (City/State)</th>
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

                      {/* Industry */}
                      <td className="p-3">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200 truncate max-w-[150px]">{b.industry}</div>
                        <div className="text-[10px] text-zinc-400 truncate max-w-[150px]">{b.category}</div>
                      </td>

                      {/* Location */}
                      <td className="p-3">
                        <div className="font-medium text-zinc-800 dark:text-zinc-200">{b.city}, {b.state}</div>
                        <div className="text-[10px] font-mono text-zinc-400">{b.pincode}</div>
                      </td>

                      {/* Phone */}
                      <td className="p-3 font-mono font-medium text-zinc-700 dark:text-zinc-300">
                        {b.phone || <span className="text-zinc-400 italic">No Phone</span>}
                      </td>

                      {/* Website */}
                      <td className="p-3">
                        {b.hasWebsite ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-800 dark:text-zinc-200">
                            <Globe className="w-3 h-3 text-zinc-500" />
                            <span className="truncate max-w-[100px]">{b.website.replace('https://', '')}</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-400 italic">No Website</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-3 text-center">
                        {getStatusBadge(b.status)}
                      </td>

                      {/* Score */}
                      <td className="p-3 text-center">
                        <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100">{b.opportunityScore}</span>
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
                    <p className="font-semibold text-sm">No business records found</p>
                    <p className="text-xs text-zinc-400 mt-1">Try adjusting your filters or search keywords.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-zinc-500 font-medium">
            Showing <span className="font-semibold text-zinc-900 dark:text-zinc-100">{filtered.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to <span className="font-semibold text-zinc-900 dark:text-zinc-100">{Math.min(currentPage * pageSize, filtered.length)}</span> of <span className="font-semibold text-zinc-900 dark:text-zinc-100">{filtered.length.toLocaleString()}</span> filtered records
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono font-semibold px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 disabled:opacity-40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}
