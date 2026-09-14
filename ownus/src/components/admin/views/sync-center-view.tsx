'use client';

import React, { useState } from 'react';
import { 
  RefreshCw, 
  Search, 
  Database, 
  Cpu, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Sparkles, 
  Layers, 
  HardDrive, 
  Activity, 
  Clock, 
  Zap, 
  ArrowUpRight,
  ShieldCheck,
  Server
} from 'lucide-react';
import { SearchIndexStatus } from '@/types/admin';

interface SyncCenterViewProps {
  indexStatus: SearchIndexStatus;
  onRebuildIndex?: () => void;
  onOptimizeIndex?: () => void;
  onFlushCache?: () => void;
}

export const SyncCenterView: React.FC<SyncCenterViewProps> = ({
  indexStatus,
  onRebuildIndex,
  onOptimizeIndex,
  onFlushCache,
}) => {
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isFlushing, setIsFlushing] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState(0);

  const handleTriggerRebuild = () => {
    setIsRebuilding(true);
    setRebuildProgress(10);
    const interval = setInterval(() => {
      setRebuildProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsRebuilding(false);
          if (onRebuildIndex) onRebuildIndex();
          return 100;
        }
        return prev + 20;
      });
    }, 400);
  };

  const handleTriggerOptimize = () => {
    setIsOptimizing(true);
    setTimeout(() => {
      setIsOptimizing(false);
      if (onOptimizeIndex) onOptimizeIndex();
    }, 1500);
  };

  const handleTriggerFlush = () => {
    setIsFlushing(true);
    setTimeout(() => {
      setIsFlushing(false);
      if (onFlushCache) onFlushCache();
    }, 800);
  };

  // Mock sync runs
  const syncRuns = [
    { id: 'SYNC-RUN-801', target: 'Elasticsearch Production Cluster', type: 'Delta Sync', status: 'Completed', records: 4500, duration: '18s', timestamp: '10 minutes ago' },
    { id: 'SYNC-RUN-800', target: 'Vector Embedding Index (Pinecone/Milvus)', type: 'KNN Embedding Refresh', status: 'Completed', records: 1200, duration: '45s', timestamp: '1 hour ago' },
    { id: 'SYNC-RUN-799', target: 'Discover Full-Text Facet Cache', type: 'Cache Invalidation', status: 'Completed', records: 1120400, duration: '4s', timestamp: '2 hours ago' },
    { id: 'SYNC-RUN-798', target: 'Elasticsearch Production Cluster', type: 'Full Segment Optimization', status: 'Completed', records: 1120400, duration: '2m 10s', timestamp: '4 hours ago' },
    { id: 'SYNC-RUN-797', target: 'Elasticsearch Production Cluster', type: 'Delta Sync', status: 'Warning', records: 320, duration: '32s', timestamp: '6 hours ago', note: '12 documents throttled' }
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                Search Index & Sync Center
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Manage Elasticsearch indices, vector embeddings, cluster shards, and Discover customer-facing search replicas.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleTriggerFlush}
            disabled={isFlushing}
            className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isFlushing ? 'Flushing...' : 'Flush Cache'}
          </button>
          <button
            onClick={handleTriggerOptimize}
            disabled={isOptimizing}
            className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
          >
            {isOptimizing ? 'Optimizing Shards...' : 'Optimize Index'}
          </button>
          <button
            onClick={handleTriggerRebuild}
            disabled={isRebuilding}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-xs font-semibold rounded-xl transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
            <span>{isRebuilding ? 'Rebuilding Index...' : 'Rebuild Index'}</span>
          </button>
        </div>
      </div>

      {/* Progress Bar during active rebuild */}
      {isRebuilding && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-900 dark:text-zinc-100" />
              Re-indexing Master Document Catalog ({rebuildProgress}%)
            </span>
            <span className="font-mono text-zinc-500">{((indexStatus.indexedBusinesses * rebuildProgress) / 100).toLocaleString()} / {indexStatus.indexedBusinesses.toLocaleString()} docs</span>
          </div>
          <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-zinc-900 dark:bg-zinc-100 h-2 rounded-full transition-all duration-300"
              style={{ width: `${rebuildProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Status Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Indexed Businesses
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            {indexStatus.indexedBusinesses.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Live in Discover
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Pending Index
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            {indexStatus.pendingIndex.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            In Kafka buffer
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Failed Index
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            {indexStatus.failedIndex}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            Dead-letter queue
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Cluster Health
          </div>
          <div className="flex items-center gap-1.5 text-xl font-bold text-zinc-900 dark:text-zinc-100">
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-900 dark:bg-zinc-100 animate-pulse" />
            <span>{indexStatus.clusterHealth}</span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            {indexStatus.shardsCount} Primary Shards
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Index Size
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            {indexStatus.indexSizeBytes}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            Compressed Lucene
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Avg Query Latency
          </div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            {indexStatus.avgQueryLatencyMs} ms
          </div>
          <div className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-1">
            p99 &lt; 28ms
          </div>
        </div>
      </div>

      {/* Primary Shards Topology Visualizer */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Distributed Shard Architecture
            </h2>
            <p className="text-xs text-zinc-500">
              Active primary partitions across Raft consensus cluster nodes.
            </p>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            6/6 Shards Synchronized
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1, 2, 3, 4, 5, 6].map(shardId => (
            <div 
              key={shardId} 
              className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100">
                  Shard #{shardId}
                </span>
                <span className="w-2 h-2 rounded-full bg-zinc-900 dark:bg-zinc-100" />
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between text-zinc-500">
                  <span>Docs:</span>
                  <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300">~186.7k</span>
                </div>
                <div className="flex justify-between text-zinc-500">
                  <span>Size:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">803 MB</span>
                </div>
                <div className="flex justify-between text-zinc-500">
                  <span>Replicas:</span>
                  <span className="font-mono text-zinc-700 dark:text-zinc-300">2 Synced</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Sync Runs History */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Recent Sync & Index Pipeline Runs
            </h2>
          </div>
          <span className="text-xs text-zinc-500">Auto-refreshing every 30s</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 font-semibold border-b border-zinc-200 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-3 font-medium">Run ID</th>
                <th className="px-4 py-3 font-medium">Index Target</th>
                <th className="px-4 py-3 font-medium">Operation Type</th>
                <th className="px-4 py-3 font-medium">Documents Synced</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 font-mono">
              {syncRuns.map(run => (
                <tr key={run.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
                  <td className="px-4 py-3 font-bold text-zinc-900 dark:text-zinc-100">{run.id}</td>
                  <td className="px-4 py-3 font-sans text-zinc-800 dark:text-zinc-200">{run.target}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{run.type}</td>
                  <td className="px-4 py-3 font-bold text-zinc-900 dark:text-zinc-100">{run.records.toLocaleString()}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{run.duration}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-sans font-semibold border bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700">
                      {run.status === 'Completed' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-sans text-zinc-500">{run.timestamp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
