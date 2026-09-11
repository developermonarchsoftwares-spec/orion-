'use client';

import React, { useState } from 'react';
import { DuplicatePair } from '@/types/admin';
import { X, Check, CopyX, ArrowRight, Merge, Trash2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DuplicateResolutionModalProps {
  duplicatePair: DuplicatePair | null;
  isOpen: boolean;
  onClose: () => void;
  onResolve: (id: string, action: 'merged' | 'ignored' | 'deleted', selectedAttributes?: any) => void;
}

export function DuplicateResolutionModal({
  duplicatePair,
  isOpen,
  onClose,
  onResolve
}: DuplicateResolutionModalProps) {
  if (!isOpen || !duplicatePair) return null;

  const { original, duplicate, confidenceScore, matchReasons } = duplicatePair;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in-50">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden text-xs">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4 bg-zinc-50/50 dark:bg-zinc-900/30">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs text-zinc-400">{duplicatePair.id}</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                {confidenceScore}% Match Confidence
              </span>
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 mt-1">Duplicate Conflict Resolution</h2>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {matchReasons.map((r, i) => (
                <span key={i} className="text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-md font-medium">
                  {r}
                </span>
              ))}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Side-by-Side Comparison Grid */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            
            {/* Master / Original Record */}
            <div className="p-4 rounded-xl border-2 border-zinc-900 dark:border-zinc-100 bg-zinc-50/50 dark:bg-zinc-900/40 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
                <span className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-zinc-900 dark:text-white" />
                  Primary / Master Record
                </span>
                <span className="font-mono text-[11px] text-zinc-500">{original.id}</span>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Business Name</span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">{original.name}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Industry & Category</span>
                  <p className="text-zinc-700 dark:text-zinc-300">{original.industry} • {original.category}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Phone Number</span>
                  <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{original.phone}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Email</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">{original.email || '—'}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Website</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">{original.website || '—'}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Physical Address</span>
                  <p className="text-zinc-700 dark:text-zinc-300">{original.address}, {original.city}, {original.state} - {original.pincode}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Quality & Status</span>
                  <p className="text-zinc-700 dark:text-zinc-300 capitalize">{original.status} • {original.dataQualityScore}% Quality</p>
                </div>
              </div>
            </div>

            {/* Ingested Duplicate Record */}
            <div className="p-4 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
                <span className="font-bold text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                  <CopyX className="w-4 h-4 text-zinc-400" />
                  Candidate Duplicate
                </span>
                <span className="font-mono text-[11px] text-zinc-500">{duplicate.id}</span>
              </div>

              <div className="space-y-2">
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Business Name</span>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100">{duplicate.name}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Industry & Category</span>
                  <p className="text-zinc-700 dark:text-zinc-300">{duplicate.industry} • {duplicate.category}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Phone Number</span>
                  <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{duplicate.phone}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Email</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">{duplicate.email || '—'}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Website</span>
                  <p className="font-mono text-zinc-700 dark:text-zinc-300">{duplicate.website || '—'}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Physical Address</span>
                  <p className="text-zinc-700 dark:text-zinc-300">{duplicate.address}, {duplicate.city}, {duplicate.state} - {duplicate.pincode}</p>
                </div>
                <div>
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Quality & Status</span>
                  <p className="text-zinc-700 dark:text-zinc-300 capitalize">{duplicate.status} • {duplicate.dataQualityScore}% Quality</p>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Action Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex justify-between items-center flex-wrap gap-2">
          <button
            onClick={() => onResolve(duplicatePair.id, 'ignored')}
            className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            Mark as Distinct (Ignore)
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => onResolve(duplicatePair.id, 'deleted')}
              className="px-4 py-2 rounded-lg font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Duplicate</span>
            </button>
            <button
              onClick={() => onResolve(duplicatePair.id, 'merged')}
              className="px-4 py-2 rounded-lg font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <Merge className="w-3.5 h-3.5" />
              <span>Merge into Master</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
