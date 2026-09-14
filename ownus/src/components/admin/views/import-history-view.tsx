'use client';

import React, { useState } from 'react';
import { ImportBatch } from '@/types/admin';
import { 
  History, 
  Download, 
  RotateCcw, 
  Trash2, 
  Eye, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle,
  Clock,
  Search
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImportHistoryViewProps {
  batches: ImportBatch[];
  onRetryBatch?: (id: string) => void;
  onDeleteBatch?: (id: string) => void;
  onDownloadReport?: (batch: ImportBatch) => void;
}

export function ImportHistoryView({
  batches,
  onRetryBatch,
  onDeleteBatch,
  onDownloadReport
}: ImportHistoryViewProps) {
  const [search, setSearch] = useState('');
  const [selectedBatch, setSelectedBatch] = useState<ImportBatch | null>(null);

  const filtered = batches.filter(b => 
    b.fileName.toLowerCase().includes(search.toLowerCase()) ||
    b.id.toLowerCase().includes(search.toLowerCase()) ||
    b.uploadedBy.toLowerCase().includes(search.toLowerCase())
  );

  const getStatusBadge = (status: ImportBatch['status']) => {
    switch (status) {
      case 'Completed':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 uppercase">Completed</span>;
      case 'Warning':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 uppercase">Warning</span>;
      case 'Processing':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 uppercase animate-pulse">Processing</span>;
      case 'Validating':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 uppercase">Validating</span>;
      case 'Failed':
        return <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 uppercase line-through">Failed</span>;
    }
  };

  return (
    <div className="space-y-4 pb-12 text-zinc-900 dark:text-zinc-100 text-xs">
      
      {/* Top Search Bar */}
      <div className="bg-white dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search batches by file name, ID or user..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-hidden"
          />
        </div>
        <div className="font-mono text-zinc-500 text-[11px] hidden sm:block">
          Total Historical Batches: {batches.length}
        </div>
      </div>

      {/* Ingestion Jobs History Table */}
      <div className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-bold text-zinc-500 uppercase tracking-wider sticky top-0 z-10">
              <tr>
                <th className="p-3.5">Batch ID & Source File</th>
                <th className="p-3.5">Uploaded By</th>
                <th className="p-3.5">Import Date</th>
                <th className="p-3.5 text-right">Total Rows</th>
                <th className="p-3.5 text-right">Valid</th>
                <th className="p-3.5 text-right">Duplicates</th>
                <th className="p-3.5 text-right">Failed</th>
                <th className="p-3.5 text-center">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors font-mono">
                  <td className="p-3.5 font-sans">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-zinc-400 shrink-0" />
                      <div>
                        <p className="font-bold text-zinc-900 dark:text-zinc-100 truncate max-w-[220px]">{b.fileName}</p>
                        <span className="font-mono text-[10px] text-zinc-400">{b.id} • {b.fileSize}</span>
                      </div>
                    </div>
                  </td>
                  <td className="p-3.5 font-sans text-zinc-700 dark:text-zinc-300 font-medium">
                    {b.uploadedBy}
                  </td>
                  <td className="p-3.5 text-zinc-500 font-sans text-[11px]">
                    {b.uploadedAt}
                  </td>
                  <td className="p-3.5 text-right font-bold text-zinc-900 dark:text-zinc-100">
                    {b.totalRecords.toLocaleString()}
                  </td>
                  <td className="p-3.5 text-right font-semibold text-zinc-800 dark:text-zinc-200">
                    {b.successCount.toLocaleString()}
                  </td>
                  <td className="p-3.5 text-right text-zinc-600 dark:text-zinc-400">
                    {b.duplicateCount.toLocaleString()}
                  </td>
                  <td className="p-3.5 text-right text-zinc-600 dark:text-zinc-400">
                    {b.failedCount > 0 ? (
                      <span className="font-bold underline">{b.failedCount}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="p-3.5 text-center font-sans">
                    {getStatusBadge(b.status)}
                  </td>
                  <td className="p-3.5 text-right font-sans">
                    <div className="flex items-center justify-end gap-1.5">
                      {onDownloadReport && (
                        <button
                          onClick={() => onDownloadReport(b)}
                          title="Download validation & error report"
                          className="p-1 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {b.status === 'Failed' && onRetryBatch && (
                        <button
                          onClick={() => onRetryBatch(b.id)}
                          title="Retry failed batch"
                          className="p-1 rounded-md text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onDeleteBatch && (
                        <button
                          onClick={() => onDeleteBatch(b.id)}
                          title="Delete historical log"
                          className="p-1 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
