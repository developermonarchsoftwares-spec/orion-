'use client';

import React, { useState } from 'react';
import { 
  Sparkles, 
  Search, 
  RefreshCw, 
  Play, 
  Pause, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Globe, 
  Share2, 
  MapPin, 
  Phone, 
  Mail, 
  Tag, 
  FileText, 
  Image, 
  BrainCircuit,
  RotateCcw,
  SlidersHorizontal
} from 'lucide-react';
import { 
  EnrichmentJob, 
  EnrichmentQueueStatus, 
  EnrichmentTaskType 
} from '@/types/admin';

interface EnrichmentQueueViewProps {
  jobs: EnrichmentJob[];
  onRetryJob: (jobId: string) => void;
  onEnqueueJob?: (taskType: EnrichmentTaskType) => void;
  onCancelJob?: (jobId: string) => void;
  onRunAll?: () => void;
}

const ENRICHMENT_TYPE_ICONS: Record<EnrichmentTaskType, React.ElementType> = {
  'Website Detection': Globe,
  'Social Presence': Share2,
  'Google Business Detection': MapPin,
  'Phone Verification': Phone,
  'Email Validation': Mail,
  'Category Classification': Tag,
  'Business Description': FileText,
  'Logo Detection': Image,
  'AI Summary': BrainCircuit,
};

export const EnrichmentQueueView: React.FC<EnrichmentQueueViewProps> = ({
  jobs,
  onRetryJob,
  onEnqueueJob,
  onCancelJob,
  onRunAll,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedTaskType, setSelectedTaskType] = useState<string>('ALL');
  const [selectedJobForDetail, setSelectedJobForDetail] = useState<EnrichmentJob | null>(null);

  const filteredJobs = jobs.filter(job => {
    const matchesSearch = 
      job.businessName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.industry.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === 'ALL' || job.status === selectedStatus;
    const matchesTask = selectedTaskType === 'ALL' || job.taskType === selectedTaskType;
    return matchesSearch && matchesStatus && matchesTask;
  });

  const queuedCount = jobs.filter(j => j.status === 'Queued').length;
  const runningCount = jobs.filter(j => j.status === 'Running').length;
  const completedCount = jobs.filter(j => j.status === 'Completed').length;
  const failedCount = jobs.filter(j => j.status === 'Failed').length;

  const getStatusBadge = (status: EnrichmentQueueStatus) => {
    switch (status) {
      case 'Running':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700"><RefreshCw className="w-3 h-3 text-zinc-300 animate-spin" /> Running</span>;
      case 'Queued':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-800"><Clock className="w-3 h-3 text-zinc-400" /> Queued</span>;
      case 'Completed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700"><CheckCircle2 className="w-3 h-3 text-zinc-300" /> Completed</span>;
      case 'Failed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800"><XCircle className="w-3 h-3 text-zinc-400" /> Failed</span>;
      case 'Skipped':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-500 border border-zinc-800">Skipped</span>;
      default:
        return status;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-zinc-300" />
            Async Data Enrichment Queue
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Distributed worker queue automating website detection, tele-verification, social presence, LLM business summaries, and logo extraction.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              if (onRunAll) onRunAll();
              else if (onEnqueueJob) onEnqueueJob('AI Summary');
            }}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow"
          >
            <BrainCircuit className="w-4 h-4" />
            Trigger AI Batch Enrichment
          </button>
        </div>
      </div>

      {/* 9 Enrichment Types Placeholder Grid */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Supported Intelligence Pipeline Modules</span>
          <span className="text-[11px] font-mono text-zinc-500">9 Specialized Autonomous Workers</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
          {(Object.keys(ENRICHMENT_TYPE_ICONS) as EnrichmentTaskType[]).map(task => {
            const Icon = ENRICHMENT_TYPE_ICONS[task];
            const isSelected = selectedTaskType === task;
            return (
              <button
                key={task}
                onClick={() => setSelectedTaskType(isSelected ? 'ALL' : task)}
                className={`p-3 rounded-xl border text-center flex flex-col items-center justify-center gap-1.5 transition ${
                  isSelected
                    ? 'bg-zinc-100 text-zinc-950 font-bold border-zinc-200 shadow'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:bg-zinc-800/60'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-[10px] leading-tight font-medium line-clamp-2">{task}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Active Workers Running</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{runningCount} Tasks</div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <RefreshCw className="w-3.5 h-3.5 text-zinc-300 animate-spin" /> Concurrency: 16 threads
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Waiting in Queue</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{queuedCount} Jobs</div>
          <div className="text-xs text-zinc-400 mt-1">
            Avg queue latency: 14s
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Completed Today</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{completedCount + 1420}</div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> 98.6% success rate
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Failed / Retriable</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{failedCount}</div>
          <div className="text-xs text-zinc-400 mt-1">
            Auto-retry policy: 3 attempts
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by business name, job ID, or industry..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={selectedTaskType}
            onChange={e => setSelectedTaskType(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Task Types (9 Workers)</option>
            {(Object.keys(ENRICHMENT_TYPE_ICONS) as EnrichmentTaskType[]).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="Running">Running</option>
            <option value="Queued">Queued</option>
            <option value="Completed">Completed</option>
            <option value="Failed">Failed</option>
            <option value="Skipped">Skipped</option>
          </select>
        </div>
      </div>

      {/* Enrichment Queue Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Job ID & Business</th>
                <th className="py-3.5 px-4">Task Worker</th>
                <th className="py-3.5 px-4">Progress</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Started / Duration</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {filteredJobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500 font-sans">
                    <Sparkles className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No enrichment jobs match the filtered criteria.
                  </td>
                </tr>
              ) : (
                filteredJobs.map(job => {
                  const TaskIcon = ENRICHMENT_TYPE_ICONS[job.taskType] || Sparkles;
                  return (
                    <tr key={job.id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-3.5 px-4 font-sans">
                        <div className="font-bold text-zinc-100 text-sm">{job.businessName}</div>
                        <div className="font-mono text-[11px] text-zinc-400 mt-0.5">{job.id} • {job.industry}</div>
                      </td>

                      <td className="py-3.5 px-4 font-sans text-xs">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-200 border border-zinc-700 font-semibold">
                          <TaskIcon className="w-3.5 h-3.5 text-zinc-400" />
                          {job.taskType}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-sans w-48">
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-zinc-400">{job.progress}%</span>
                        </div>
                        <div className="w-full bg-zinc-950 rounded-full h-1.5 overflow-hidden border border-zinc-800">
                          <div 
                            className="bg-zinc-200 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      </td>

                      <td className="py-3.5 px-4 font-sans">
                        {getStatusBadge(job.status)}
                      </td>

                      <td className="py-3.5 px-4 font-sans text-zinc-400 text-xs">
                        <div>{job.started}</div>
                        {job.duration && <div className="text-[11px] text-zinc-500 font-mono mt-0.5">Duration: {job.duration}</div>}
                      </td>

                      <td className="py-3.5 px-4 text-right font-sans">
                        <div className="flex items-center justify-end gap-1.5">
                          {job.status === 'Failed' && (
                            <button
                              onClick={() => onRetryJob(job.id)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition flex items-center gap-1"
                              title="Retry Failed Extraction Worker"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Retry
                            </button>
                          )}

                          {job.extractedData && (
                            <button
                              onClick={() => setSelectedJobForDetail(job)}
                              className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                            >
                              View Payload
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Extracted Payload Modal */}
      {selectedJobForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs font-sans text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="font-bold text-zinc-100 text-sm flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-zinc-300" />
                Enrichment Extraction Output
              </h3>
              <button
                onClick={() => setSelectedJobForDetail(null)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <div className="font-semibold text-zinc-200">{selectedJobForDetail.businessName}</div>
              <div className="text-zinc-400 font-mono text-[11px]">{selectedJobForDetail.taskType} • {selectedJobForDetail.id}</div>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1.5 font-mono text-[11px]">
              {selectedJobForDetail.extractedData && Object.entries(selectedJobForDetail.extractedData).map(([k, v]) => (
                <div key={k} className="flex justify-between py-1 border-b border-zinc-800/40">
                  <span className="text-zinc-400 font-sans">{k}</span>
                  <span className="text-zinc-200 font-bold max-w-xs truncate">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedJobForDetail(null)}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
