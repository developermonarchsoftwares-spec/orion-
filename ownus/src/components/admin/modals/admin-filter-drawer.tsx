'use client';

import React, { useEffect } from 'react';
import {
  X,
  SlidersHorizontal,
  RotateCcw,
  Check
} from 'lucide-react';
import {
  DiscoverFilters,
  DiscoverFilterState
} from '@/components/discover/discover-filters';

interface AdminFilterDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  filters: DiscoverFilterState;
  onChange: (filters: DiscoverFilterState) => void;
  onReset: () => void;
  activeFiltersCount: number;
  title?: string;
  totalFilteredCount?: number;
}

export function AdminFilterDrawer({
  isOpen,
  onClose,
  filters,
  onChange,
  onReset,
  activeFiltersCount,
  title = 'Advanced Business Filters',
  totalFilteredCount,
}: AdminFilterDrawerProps) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Semi-transparent Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in-50 cursor-pointer"
        aria-hidden="true"
      />

      {/* Slide-over Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-md sm:max-w-lg bg-white dark:bg-zinc-950 h-full shadow-2xl border-l border-zinc-200 dark:border-zinc-800 flex flex-col animate-in slide-in-from-right duration-300 select-none text-zinc-900 dark:text-zinc-100"
      >
        {/* Drawer Header */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/80 dark:bg-zinc-900/60 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 shadow-xs shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
                {activeFiltersCount > 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                    {activeFiltersCount} active
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500">
                All customer portal search &amp; filter options
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white flex items-center gap-1 px-2 py-1 rounded hover:bg-zinc-200/50 dark:hover:bg-zinc-800 transition cursor-pointer"
                title="Reset all filters to defaults"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
              title="Close filter drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Drawer Body - Houses DiscoverFilters */}
        <div className="flex-1 overflow-hidden min-h-0">
          <DiscoverFilters
            filters={filters}
            onChange={onChange}
            onReset={onReset}
            totalActiveFiltersCount={activeFiltersCount}
            className="border-0 rounded-none shadow-none h-full"
          />
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/80 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-zinc-500">
            {totalFilteredCount !== undefined && (
              <span>
                Matching Records: <strong className="text-zinc-900 dark:text-zinc-100 font-mono">{totalFilteredCount}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-100 dark:text-zinc-900 shadow-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Apply Filters</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
