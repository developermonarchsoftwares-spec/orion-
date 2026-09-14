'use client';

import React, { useState } from 'react';
import { 
  HeartPulse, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RefreshCw, 
  Server, 
  Database, 
  Cpu, 
  HardDrive, 
  Layers, 
  Activity, 
  Clock, 
  ShieldCheck, 
  Zap, 
  RotateCcw,
  Sliders,
  ExternalLink
} from 'lucide-react';
import { SystemServiceHealth, ServiceHealthStatus } from '@/types/admin';

interface SystemHealthViewProps {
  services: SystemServiceHealth[];
  onRestartService?: (id: string) => void;
  onRefreshHealth?: () => void;
}

export const SystemHealthView: React.FC<SystemHealthViewProps> = ({
  services,
  onRestartService,
  onRefreshHealth,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [restartingId, setRestartingId] = useState<string | null>(null);

  // Overall platform status
  const allHealthy = services.every(s => s.status === 'Healthy');
  const warningCount = services.filter(s => s.status === 'Warning').length;
  const offlineCount = services.filter(s => s.status === 'Offline').length;

  const handleRestart = (id: string) => {
    setRestartingId(id);
    setTimeout(() => {
      setRestartingId(null);
      if (onRestartService) onRestartService(id);
    }, 1500);
  };

  const filteredServices = services.filter(s => {
    if (selectedCategory === 'all') return true;
    return s.category === selectedCategory;
  });

  const categories = [
    'all',
    'Import Service',
    'Validation Service',
    'Search Index',
    'Database',
    'Queue Workers',
    'Storage',
    'AI Workers',
    'Cache'
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
              <HeartPulse className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                  System Health & Microservices Observability
                </h1>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 animate-pulse" />
                  All Systems Operational (99.98% SLA)
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Real-time telemetry across Ingestion, Database Raft Consensus, GPU Triton Inference, and Redis Caches.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefreshHealth}
            className="flex items-center gap-2 px-3.5 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Poll Telemetry</span>
          </button>
        </div>
      </div>

      {/* Cluster Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Active Core Pods
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            64 / 64
          </div>
          <div className="text-[10px] text-zinc-600 dark:text-zinc-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> 100% Target Availability
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Average Pod Latency
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            18.5 ms
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            p95 &lt; 45ms across services
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Global Error Rate
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            0.02%
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            Within 0.05% error budget
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl shadow-sm">
          <div className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
            Replication Lag
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 font-mono">
            0.00 ms
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            Synchronous quorum
          </div>
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap items-center gap-2 pb-1">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedCategory === cat
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            {cat === 'all' ? 'All Services (8)' : cat}
          </button>
        ))}
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredServices.map(svc => (
          <div
            key={svc.id}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4.5 shadow-sm space-y-3 flex flex-col justify-between"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {svc.category}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
                    {svc.status}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {svc.name}
                </h3>
              </div>

              <button
                onClick={() => handleRestart(svc.id)}
                disabled={restartingId === svc.id}
                title="Restart microservice pods"
                className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className={`w-4 h-4 ${restartingId === svc.id ? 'animate-spin text-zinc-900 dark:text-zinc-100' : ''}`} />
              </button>
            </div>

            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              {svc.details}
            </p>

            {/* Performance Gauges */}
            <div className="space-y-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800/80">
              {/* CPU Usage Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" /> CPU Load
                  </span>
                  <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{svc.cpuUsage}%</span>
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all bg-zinc-900 dark:bg-zinc-100"
                    style={{ width: `${svc.cpuUsage}%` }}
                  />
                </div>
              </div>

              {/* Memory Usage Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-zinc-400" /> Memory Allocation
                  </span>
                  <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{svc.memoryUsage}%</span>
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full transition-all bg-zinc-900 dark:bg-zinc-100"
                    style={{ width: `${svc.memoryUsage}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Metrics Footer */}
            <div className="grid grid-cols-4 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-[11px] font-mono">
              <div>
                <span className="text-zinc-400 block text-[10px] font-sans">Latency</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">{svc.latencyMs} ms</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[10px] font-sans">Uptime</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">{svc.uptime}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[10px] font-sans">Errors</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">{svc.errorRate}</span>
              </div>
              <div>
                <span className="text-zinc-400 block text-[10px] font-sans">Scale</span>
                <span className="font-bold text-zinc-900 dark:text-zinc-100">{svc.instances}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
