'use client';

import React, { useState, useMemo } from 'react';
import { DuplicatePair, AdminBusinessRecord, ConfidenceTier } from '@/types/admin';
import {
  CopyX,
  Merge,
  Trash2,
  Check,
  Search,
  CheckCircle2,
  SlidersHorizontal,
  ArrowRight,
  Eye,
  Sliders,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  AlertTriangle,
  FileCheck,
  ArrowUpDown,
  Filter
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DuplicateManagerViewProps {
  duplicates: DuplicatePair[];
  onOpenMergePreview: (pair: DuplicatePair) => void;
  onKeepOriginal: (pairId: string) => void;
  onKeepNew: (pairId: string) => void;
  onIgnore: (pairId: string) => void;
  onDeleteDuplicate: (pairId: string) => void;
  onBulkMerge: (pairIds: string[]) => void;
}

export function DuplicateManagerView({
  duplicates,
  onOpenMergePreview,
  onKeepOriginal,
  onKeepNew,
  onIgnore,
  onDeleteDuplicate,
  onBulkMerge,
}: DuplicateManagerViewProps) {
  const [minConfidence, setMinConfidence] = useState<number>(50);
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPairIds, setSelectedPairIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending');

  const pendingPairs = useMemo(() => duplicates.filter(d => d.status === 'pending'), [duplicates]);
  const resolvedPairs = useMemo(() => duplicates.filter(d => d.status !== 'pending'), [duplicates]);

  const activeList = activeTab === 'pending' ? pendingPairs : resolvedPairs;

  const filteredPairs = useMemo(() => {
    return activeList.filter(d => {
      if (d.confidenceScore < minConfidence) return false;
      if (selectedTier !== 'all' && (d.confidenceTier || 'High') !== selectedTier) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        return (
          d.original.name.toLowerCase().includes(q) ||
          d.duplicate.name.toLowerCase().includes(q) ||
          d.original.phone.includes(q) ||
          d.duplicate.phone.includes(q) ||
          d.id.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [activeList, minConfidence, selectedTier, searchQuery]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedPairIds(filteredPairs.map(p => p.id));
    } else {
      setSelectedPairIds([]);
    }
  };

  const handleToggleSelect = (id: string) => {
    setSelectedPairIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const getTierBadge = (score: number) => {
    if (score >= 90) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">Very High ({score}%)</span>;
    if (score >= 75) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900">High ({score}%)</span>;
    if (score >= 50) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">Medium ({score}%)</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-500">Low ({score}%)</span>;
  };

  return (
    <div className="space-y-6 pb-12 text-zinc-900 dark:text-zinc-100 text-xs">
      
      {/* Top Banner */}
      <div className="bg-white dark:bg-zinc-950 p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <CopyX className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
              Automated Duplicate Detection & Resolution Manager
            </h1>
            <span className="px-2.5 py-0.5 text-[11px] font-bold rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
              Fuzzy Matcher
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Detects duplicate business entities using fuzzy Levenshtein distance on names, exact phone/email/domain matching, and spatial address proximity.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl flex">
            <button
              onClick={() => setActiveTab('pending')}
              className={cn(
                'px-4 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer',
                activeTab === 'pending' ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
              )}
            >
              Pending ({pendingPairs.length})
            </button>
            <button
              onClick={() => setActiveTab('resolved')}
              className={cn(
                'px-4 py-1.5 text-xs font-bold rounded-lg transition cursor-pointer',
                activeTab === 'resolved' ? 'bg-white dark:bg-zinc-950 text-zinc-900 dark:text-white shadow-xs' : 'text-zinc-500 hover:text-zinc-900'
              )}
            >
              Resolved ({resolvedPairs.length})
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider block">Pending Duplicate Pairs</span>
          <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-1">
            {pendingPairs.length}
          </div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Awaiting administrator review</span>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider block">Very High Confidence (≥90%)</span>
          <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-1">
            {pendingPairs.filter(p => p.confidenceScore >= 90).length}
          </div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Eligible for automated bulk merge</span>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider block">Total Merged Lifetime</span>
          <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-1">
            492
          </div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Entities consolidated</span>
        </div>

        <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xs">
          <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider block">Cluster Duplicate Rate</span>
          <div className="text-2xl font-bold font-mono text-zinc-900 dark:text-zinc-100 mt-1">
            3.4%
          </div>
          <span className="text-[10px] text-zinc-500 mt-0.5 block">Within 5% target boundary</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search duplicates by business name, phone, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Confidence Slider */}
          <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <span className="text-[11px] text-zinc-400 font-medium">Min Confidence:</span>
            <input
              type="range"
              min={30}
              max={95}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-24 accent-zinc-900 dark:accent-white cursor-pointer"
            />
            <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 text-xs w-8">{minConfidence}%</span>
          </div>

          <select
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
            className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none"
          >
            <option value="all">All Confidence Tiers</option>
            <option value="Very High">Very High (90-100%)</option>
            <option value="High">High (75-89%)</option>
            <option value="Medium">Medium (50-74%)</option>
            <option value="Low">Low (&lt;50%)</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      {selectedPairIds.length > 0 && (
        <div className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 px-5 py-3 rounded-xl shadow-lg flex items-center justify-between animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 font-semibold">
            <span className="px-2 py-0.5 rounded-full bg-zinc-800 dark:bg-zinc-200 text-xs font-mono">
              {selectedPairIds.length} Pairs Selected
            </span>
            <span>Bulk Resolution:</span>
          </div>

          <button
            onClick={() => {
              onBulkMerge(selectedPairIds);
              setSelectedPairIds([]);
            }}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 dark:bg-zinc-200 dark:hover:bg-zinc-300 text-xs font-bold rounded-lg transition cursor-pointer flex items-center gap-1.5"
          >
            <Merge className="w-3.5 h-3.5" />
            Auto-Merge Selected ({selectedPairIds.length})
          </button>
        </div>
      )}

      {/* Duplicate Pairs List */}
      <div className="space-y-4">
        {filteredPairs.length === 0 ? (
          <div className="p-12 text-center border border-zinc-200 dark:border-zinc-800 rounded-2xl bg-white dark:bg-zinc-950 text-zinc-500">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-zinc-400" />
            No duplicate conflicts found matching the active criteria.
          </div>
        ) : (
          filteredPairs.map((pair) => {
            const isSelected = selectedPairIds.includes(pair.id);
            return (
              <div
                key={pair.id}
                className={cn(
                  'border rounded-2xl bg-white dark:bg-zinc-950 overflow-hidden shadow-xs transition-all',
                  isSelected ? 'border-zinc-900 dark:border-white ring-1 ring-zinc-900 dark:ring-white' : 'border-zinc-200 dark:border-zinc-800'
                )}
              >
                {/* Pair Top Header */}
                <div className="px-5 py-3.5 bg-zinc-50/80 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleSelect(pair.id)}
                      className="w-4 h-4 rounded accent-zinc-900 cursor-pointer"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-zinc-400 text-xs">{pair.id}</span>
                        {getTierBadge(pair.confidenceScore)}
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {pair.matchReasons.map((reason, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] font-mono px-2 py-0.2 rounded-md bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-medium"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      onClick={() => onOpenMergePreview(pair)}
                      className="px-3 py-1.5 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-bold rounded-lg hover:opacity-90 transition flex items-center gap-1.5 cursor-pointer"
                    >
                      <Merge className="w-3.5 h-3.5" />
                      Merge Preview
                    </button>
                    <button
                      onClick={() => onKeepOriginal(pair.id)}
                      title="Keep Original (Purge Duplicate)"
                      className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg text-zinc-700 dark:text-zinc-300 font-medium transition cursor-pointer"
                    >
                      Keep Original
                    </button>
                    <button
                      onClick={() => onKeepNew(pair.id)}
                      title="Keep New (Overwrite Original)"
                      className="px-2.5 py-1.5 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg text-zinc-700 dark:text-zinc-300 font-medium transition cursor-pointer"
                    >
                      Keep New
                    </button>
                    <button
                      onClick={() => onIgnore(pair.id)}
                      title="Ignore Conflict (Mark False-Positive)"
                      className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                    >
                      Ignore
                    </button>
                    <button
                      onClick={() => onDeleteDuplicate(pair.id)}
                      title="Delete Duplicate"
                      className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Side-by-Side Quick Diff Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-zinc-100 dark:divide-zinc-800 text-xs">
                  
                  {/* Master Record Column */}
                  <div className="p-4 space-y-2 bg-white dark:bg-zinc-950">
                    <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider pb-1 border-b border-zinc-100 dark:border-zinc-800">
                      <span>Original Master Record</span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100">{pair.original.id}</span>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Business Name:</span>
                        <span className="col-span-2 font-bold text-zinc-900 dark:text-zinc-100">{pair.original.name}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Phone:</span>
                        <span className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200">{pair.original.phone}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Email:</span>
                        <span className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200 truncate">{pair.original.email || 'None'}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Website:</span>
                        <span className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200 truncate">{pair.original.website || 'None'}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Address:</span>
                        <span className="col-span-2 text-zinc-700 dark:text-zinc-300">{pair.original.address}, {pair.original.city}</span>
                      </div>
                    </div>
                  </div>

                  {/* Incoming Duplicate Column */}
                  <div className="p-4 space-y-2 bg-zinc-50/40 dark:bg-zinc-900/20">
                    <div className="flex items-center justify-between text-[11px] font-bold text-zinc-400 uppercase tracking-wider pb-1 border-b border-zinc-100 dark:border-zinc-800">
                      <span>Imported Candidate Duplicate</span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100">{pair.duplicate.id}</span>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Business Name:</span>
                        <span className="col-span-2 font-bold text-zinc-900 dark:text-zinc-100">{pair.duplicate.name}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Phone:</span>
                        <span className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200">{pair.duplicate.phone}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Email:</span>
                        <span className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200 truncate">{pair.duplicate.email || 'None'}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Website:</span>
                        <span className="col-span-2 font-mono text-zinc-800 dark:text-zinc-200 truncate">{pair.duplicate.website || 'None'}</span>
                      </div>
                      <div className="grid grid-cols-3">
                        <span className="text-zinc-400">Address:</span>
                        <span className="col-span-2 text-zinc-700 dark:text-zinc-300">{pair.duplicate.address}, {pair.duplicate.city}</span>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}
