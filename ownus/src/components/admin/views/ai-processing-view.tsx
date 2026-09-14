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
  Play
} from 'lucide-react';
import { AiPipelineDefinition } from '@/types/admin';
import { INITIAL_AI_PIPELINES } from '@/lib/admin-mock-data';

interface AiProcessingViewProps {
  pipelines?: AiPipelineDefinition[];
}

export const AiProcessingView: React.FC<AiProcessingViewProps> = ({
  pipelines = INITIAL_AI_PIPELINES,
}) => {
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>(pipelines[0]?.id || 'pipe-classify');

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId) || pipelines[0];

  const businessesWaiting = 1420;
  const businessesProcessed = 1248000;
  const avgProcessingTime = '18.4 ms';
  const failedJobs = 14;
  const queueLength = 305;
  const activeGpuInstances = '4x NVIDIA A100 (80GB VRAM)';

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-zinc-300" />
            AI Processing & Deep Inference Engine
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Transformer models, neural vector deduplication, B2B commercial opportunity scoring, and graph recommendation pipelines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono bg-zinc-950 text-zinc-300 border border-zinc-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-zinc-900 dark:bg-zinc-100 animate-pulse" />
            Triton Server: Operational
          </span>
        </div>
      </div>

      {/* 5 KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Businesses Waiting</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{businessesWaiting.toLocaleString()}</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <Clock className="w-3 h-3 text-zinc-300" /> Staged for inference
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Processed Lifetime</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">1.24M</div>
          <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <CheckCircle2 className="w-3 h-3 text-zinc-300" /> Verified inferences
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Avg Processing Time</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{avgProcessingTime}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            TensorRT optimized
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Failed Jobs</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{failedJobs}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            0.001% error rate
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
          <div className="text-[11px] text-zinc-400 font-medium uppercase tracking-wider">Queue Length</div>
          <div className="text-xl font-bold text-zinc-100 mt-1">{queueLength}</div>
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            Auto-scaling pods
          </div>
        </div>
      </div>

      {/* Main Container: 5 AI Pipelines List + Pipeline Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Pipelines List */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-zinc-400 px-2 pb-1 border-b border-zinc-800 flex items-center justify-between">
            <span>AI Pipelines ({pipelines.length})</span>
            <span className="font-mono text-[10px] text-zinc-500">v3.4 Production</span>
          </div>

          <div className="space-y-1.5 pt-1">
            {pipelines.map(pipe => {
              const isSelected = selectedPipelineId === pipe.id;
              return (
                <button
                  key={pipe.id}
                  onClick={() => setSelectedPipelineId(pipe.id)}
                  className={`w-full p-3 rounded-lg text-left transition flex items-start justify-between gap-2 ${
                    isSelected
                      ? 'bg-zinc-100 text-zinc-950 font-bold shadow'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{pipe.displayName}</div>
                    <div className={`text-[11px] font-mono mt-0.5 ${isSelected ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      {pipe.model} • {pipe.accuracy}% Acc
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded shrink-0 ${
                    pipe.status === 'Active'
                      ? isSelected ? 'bg-zinc-200 text-zinc-800' : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {pipe.status}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Pipeline Detail & Architecture Panel */}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
            <div>
              <div className="flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-zinc-300" />
                <h2 className="text-base font-bold text-zinc-100">{selectedPipeline.displayName}</h2>
              </div>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                {selectedPipeline.description}
              </p>
            </div>

            <button
              onClick={() => alert(`Benchmark benchmark run started for ${selectedPipeline.displayName}`)}
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition flex items-center gap-1.5 shrink-0"
            >
              <Play className="w-3.5 h-3.5" /> Run Benchmark
            </button>
          </div>

          {/* Model Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
              <span className="text-zinc-400 block text-[10px] uppercase font-bold">Model Architecture</span>
              <span className="font-mono font-bold text-zinc-200 mt-1 block truncate" title={selectedPipeline.model}>
                {selectedPipeline.model}
              </span>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
              <span className="text-zinc-400 block text-[10px] uppercase font-bold">Validation Accuracy</span>
              <span className="font-mono font-bold text-zinc-100 mt-1 block text-base">
                {selectedPipeline.accuracy}%
              </span>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
              <span className="text-zinc-400 block text-[10px] uppercase font-bold">Inference Latency</span>
              <span className="font-mono font-bold text-zinc-200 mt-1 block">
                {selectedPipeline.avgLatencyMs} ms / doc
              </span>
            </div>

            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl">
              <span className="text-zinc-400 block text-[10px] uppercase font-bold">Processed Count</span>
              <span className="font-mono font-bold text-zinc-200 mt-1 block">
                {selectedPipeline.processedCount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Interactive Visual Execution Flow */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" /> Distributed Inference Workflow Pipeline
            </h3>

            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-300">1</span>
                  <span className="font-sans font-semibold text-zinc-200">Raw Record Vectorization & Tokenization</span>
                </div>
                <span className="text-[10px] text-zinc-400">Byte-pair encoding (512 tokens)</span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-300">2</span>
                  <span className="font-sans font-semibold text-zinc-200">TensorRT GPU Forward Pass</span>
                </div>
                <span className="text-[10px] text-zinc-400">FP16 precision batch (size 64)</span>
              </div>

              <div className="flex items-center justify-between p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center font-bold text-[10px] text-zinc-300">3</span>
                  <span className="font-sans font-semibold text-zinc-200">Confidence Calibration & Schema Injection</span>
                </div>
                <span className="text-[10px] text-zinc-400">Softmax &gt; 0.85 threshold</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
