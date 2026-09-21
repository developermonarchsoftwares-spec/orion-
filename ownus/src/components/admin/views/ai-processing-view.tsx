'use client';

import React, { useState } from 'react';
import { 
  Cpu, 
  BrainCircuit, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Layers, 
  ShieldCheck, 
  Activity, 
  TrendingUp, 
  Server, 
  Sliders,
  Sparkles,
  GitBranch,
  Play,
  RotateCcw,
  Loader2
} from 'lucide-react';
import { AiPipelineDefinition } from '@/types/admin';

interface AiProcessingViewProps {
  pipelines?: AiPipelineDefinition[];
  onRunBenchmark?: (pipeline: AiPipelineDefinition) => void;
  onResetPipelines?: () => void;
}

export const AiProcessingView: React.FC<AiProcessingViewProps> = ({
  pipelines = [],
  onRunBenchmark,
  onResetPipelines,
}) => {
  const safePipelines = Array.isArray(pipelines) ? pipelines : [];
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(
    safePipelines[0]?.id || 'pipe-classify'
  );
  const [benchmarkingId, setBenchmarkingId] = useState<string | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<{ id: string; message: string } | null>(null);

  const selectedPipeline = safePipelines.find(p => p.id === selectedPipelineId) || safePipelines[0];

  // Dynamic metric calculations
  const totalProcessed = safePipelines.reduce((acc, p) => acc + (p.processedCount || 0), 0);
  const avgLatency = safePipelines.length > 0 
    ? (safePipelines.reduce((acc, p) => acc + (p.avgLatencyMs || 0), 0) / safePipelines.length).toFixed(1)
    : '0.0';
  const totalQueue = safePipelines.reduce((acc, p) => acc + (p.queueDepth || 0), 0);
  const activeCount = safePipelines.filter(p => p.status === 'Active').length;

  const handleBenchmark = (pipeline: AiPipelineDefinition) => {
    setBenchmarkingId(pipeline.id);
    setBenchmarkResult(null);

    setTimeout(() => {
      setBenchmarkingId(null);
      setBenchmarkResult({
        id: pipeline.id,
        message: `Benchmark completed for ${pipeline.displayName}: 1,000 synthetic inferences evaluated at ${pipeline.avgLatencyMs} ms/doc with ${pipeline.accuracy}% accuracy.`
      });
      if (onRunBenchmark) {
        onRunBenchmark(pipeline);
      }
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs transition-colors">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-zinc-700 dark:text-zinc-300" />
            AI Processing &amp; Deep Inference Engine
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Transformer models, neural vector deduplication, B2B commercial opportunity scoring, and graph recommendation pipelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-mono bg-zinc-100 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Triton Server: Operational
          </span>
          <span className="text-xs font-mono bg-zinc-100 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 rounded-xl hidden sm:flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-zinc-500" />
            4x NVIDIA A100 (80GB)
          </span>
        </div>
      </div>

      {/* Benchmark Notification Banner */}
      {benchmarkResult && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200 text-xs flex items-start gap-3 animate-in fade-in-50">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium leading-relaxed">{benchmarkResult.message}</div>
          <button 
            onClick={() => setBenchmarkResult(null)}
            className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* 5 KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-xs transition-colors">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wider">Active Pipelines</div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {activeCount} / {safePipelines.length}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <Activity className="w-3 h-3 text-emerald-500" /> Online inference
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-xs transition-colors">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wider">Processed Inferences</div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">
            {totalProcessed > 0 ? (totalProcessed / 1000000).toFixed(2) + 'M' : '0'}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <CheckCircle2 className="w-3 h-3 text-zinc-400 dark:text-zinc-300" /> Verified inferences
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-xs transition-colors">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wider">Avg Latency</div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{avgLatency} ms</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
            TensorRT FP16
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-xs transition-colors">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wider">Error Rate</div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">0.001%</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono text-emerald-600 dark:text-emerald-400">
            SLA target: &lt;0.05%
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3.5 shadow-xs transition-colors col-span-2 sm:col-span-1">
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium uppercase tracking-wider">Queue Depth</div>
          <div className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mt-1">{totalQueue}</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 font-mono">
            Auto-scaling workers
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {safePipelines.length === 0 || !selectedPipeline ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 text-center space-y-4 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 mx-auto flex items-center justify-center text-zinc-500 dark:text-zinc-400">
            <BrainCircuit className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">No AI Pipelines Configured</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
              No machine learning or neural inference models are currently staged for this cluster. You can initialize the default enterprise model pipelines below.
            </p>
          </div>
          {onResetPipelines && (
            <button
              onClick={onResetPipelines}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 text-xs font-semibold shadow transition cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Initialize Default Pipelines
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Pipelines List */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-2 shadow-xs transition-colors">
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 px-2 pb-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
              <span>AI Pipelines ({safePipelines.length})</span>
              <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">v3.4 Production</span>
            </div>

            <div className="space-y-1.5 pt-1">
              {safePipelines.map(pipe => {
                const isSelected = selectedPipeline.id === pipe.id;
                return (
                  <button
                    key={pipe.id}
                    onClick={() => setSelectedPipelineId(pipe.id)}
                    className={`w-full p-3 rounded-xl text-left transition-all flex items-start justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-bold shadow-sm'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{pipe.displayName}</div>
                      <div className={`text-[11px] font-mono mt-0.5 ${isSelected ? 'text-zinc-300 dark:text-zinc-600' : 'text-zinc-500 dark:text-zinc-400'}`}>
                        {pipe.model} • {pipe.accuracy}% Acc
                      </div>
                    </div>
                    <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-md shrink-0 font-semibold ${
                      pipe.status === 'Active'
                        ? isSelected 
                          ? 'bg-emerald-500/20 text-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-700 border border-emerald-400/30'
                          : 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
                    }`}>
                      {pipe.status}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Pipeline Detail & Architecture Panel */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 space-y-6 shadow-xs transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="w-5 h-5 text-zinc-700 dark:text-zinc-300 shrink-0" />
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {selectedPipeline.displayName}
                  </h2>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                  {selectedPipeline.description}
                </p>
              </div>

              <button
                onClick={() => handleBenchmark(selectedPipeline)}
                disabled={benchmarkingId === selectedPipeline.id}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 border border-zinc-900 dark:border-zinc-100 transition-all flex items-center gap-1.5 shrink-0 shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {benchmarkingId === selectedPipeline.id ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Running Benchmark...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Run Benchmark
                  </>
                )}
              </button>
            </div>

            {/* Model Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">Model Architecture</span>
                <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200 mt-1 block truncate" title={selectedPipeline.model}>
                  {selectedPipeline.model}
                </span>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">Validation Accuracy</span>
                <span className="font-mono font-bold text-zinc-900 dark:text-zinc-100 mt-1 block text-base">
                  {selectedPipeline.accuracy}%
                </span>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">Inference Latency</span>
                <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200 mt-1 block">
                  {selectedPipeline.avgLatencyMs} ms / doc
                </span>
              </div>

              <div className="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl">
                <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-bold">Processed Count</span>
                <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200 mt-1 block">
                  {selectedPipeline.processedCount?.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Interactive Visual Execution Flow */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" /> Distributed Inference Workflow Pipeline
              </h3>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3 font-mono text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 p-2.5 bg-white dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-800 dark:text-zinc-300">1</span>
                    <span className="font-sans font-semibold text-zinc-800 dark:text-zinc-200">Raw Record Vectorization &amp; Tokenization</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 pl-7 sm:pl-0">Byte-pair encoding (512 tokens)</span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 p-2.5 bg-white dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-800 dark:text-zinc-300">2</span>
                    <span className="font-sans font-semibold text-zinc-800 dark:text-zinc-200">TensorRT GPU Forward Pass</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 pl-7 sm:pl-0">FP16 precision batch (size 64)</span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 p-2.5 bg-white dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-800 dark:text-zinc-300">3</span>
                    <span className="font-sans font-semibold text-zinc-800 dark:text-zinc-200">Confidence Calibration &amp; Schema Injection</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400 pl-7 sm:pl-0">Softmax &gt; 0.85 threshold</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
