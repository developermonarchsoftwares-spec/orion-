'use client';

import React, { useState } from 'react';
import { 
  Radio, 
  Search, 
  RefreshCw, 
  Play, 
  Pause, 
  History, 
  Eye, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Layers, 
  ShieldCheck, 
  Database,
  ExternalLink,
  Plus,
  KeyRound,
  Download
} from 'lucide-react';
import { 
  DataSourceRecord, 
  DataSourceStatus, 
  DataSourceSyncLog 
} from '@/types/admin';

interface DataSourcesViewProps {
  sources: DataSourceRecord[];
  onToggleStatus?: (sourceId: string, newStatus: DataSourceStatus) => void;
  onUpdateStatus?: (sourceId: string, newStatus: DataSourceStatus) => void;
  onManualSync: (sourceId: string) => void;
}

export const DataSourcesView: React.FC<DataSourcesViewProps> = ({
  sources,
  onToggleStatus,
  onUpdateStatus,
  onManualSync,
}) => {
  const handleStatusUpdate = onUpdateStatus || onToggleStatus || (() => {});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedSourceForDetail, setSelectedSourceForDetail] = useState<DataSourceRecord | null>(null);

  const filteredSources = sources.filter(source => {
    const matchesSearch = 
      source.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      source.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = selectedStatus === 'ALL' || source.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  const totalImported = sources.reduce((acc, s) => acc + s.recordsImported, 0);
  const activeSourcesCount = sources.filter(s => s.status === 'Connected' || s.status === 'Running').length;
  const avgSuccessRate = (sources.reduce((acc, s) => acc + s.successRate, 0) / (sources.length || 1)).toFixed(1);

  const getStatusBadge = (status: DataSourceStatus) => {
    switch (status) {
      case 'Connected':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700"><CheckCircle2 className="w-3 h-3 text-zinc-300" /> Connected</span>;
      case 'Running':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700"><RefreshCw className="w-3 h-3 text-zinc-300 animate-spin" /> Ingesting</span>;
      case 'Paused':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-800"><Pause className="w-3 h-3 text-zinc-400" /> Paused</span>;
      case 'Disconnected':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-500 border border-zinc-800">Disconnected</span>;
      case 'Failed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800"><XCircle className="w-3 h-3 text-zinc-400" /> Sync Error</span>;
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
            <Radio className="w-5 h-5 text-zinc-300" />
            Government Registries & Data Connectors
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Manage multi-channel ingestion pipelines across MSME Udyam, Ministry of Corporate Affairs (MCA), GSTN, FSSAI, and custom REST API endpoints.
          </p>
        </div>

        <button
          onClick={() => alert('New Data Source connector wizard triggered')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow self-start md:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Data Source
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Active Ingest Connectors</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{activeSourcesCount} / {sources.length}</div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1 font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> Streaming in production
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Total Records Sourced</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{totalImported.toLocaleString()}</div>
          <div className="text-xs text-zinc-400 mt-1">
            Across 8 multi-source feeds
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Average Sync Quality</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{avgSuccessRate}%</div>
          <div className="text-xs text-zinc-400 mt-1">
            Schema compliance index
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Authentication Security</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-5 h-5 text-zinc-300" /> mTLS 1.3
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Zero-trust token rotation
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by source name, type, or ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Source Statuses</option>
            <option value="Connected">Connected</option>
            <option value="Running">Running / Ingesting</option>
            <option value="Paused">Paused</option>
            <option value="Disconnected">Disconnected</option>
            <option value="Failed">Failed</option>
          </select>
        </div>
      </div>

      {/* Data Sources Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Source Name & ID</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Records Sourced</th>
                <th className="py-3.5 px-4 text-right">Success Rate</th>
                <th className="py-3.5 px-4">Last Sync / Next Sync</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {filteredSources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500 font-sans">
                    <Radio className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No data source connectors found matching the query.
                  </td>
                </tr>
              ) : (
                filteredSources.map(source => (
                  <tr key={source.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-bold text-zinc-100 text-sm">{source.name}</div>
                      <div className="font-mono text-[11px] text-zinc-400 mt-0.5">{source.id} • {source.frequency}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans text-xs text-zinc-300">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {source.category}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      {getStatusBadge(source.status)}
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="font-bold text-zinc-100">
                        {source.recordsImported.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-zinc-400">{source.errorCount} parse errors</div>
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <span className="font-bold text-zinc-200">{source.successRate}%</span>
                    </td>

                    <td className="py-3.5 px-4 font-sans text-xs text-zinc-400">
                      <div>Last: {source.lastSync}</div>
                      <div className="text-[11px] text-zinc-500 font-mono mt-0.5">Next: {source.nextSync}</div>
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => setSelectedSourceForDetail(source)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                          title="View Sync History & Endpoint Parameters"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => onManualSync(source.id)}
                          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition"
                          title="Trigger Manual Delta Sync"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>

                        {source.status === 'Running' || source.status === 'Connected' ? (
                          <button
                            onClick={() => handleStatusUpdate(source.id, 'Paused')}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition"
                            title="Pause Connector Stream"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusUpdate(source.id, 'Connected')}
                            className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 transition"
                            title="Resume Connector Stream"
                          >
                            <Play className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Source Detail & Sync History Modal */}
      {selectedSourceForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4 text-xs font-sans text-zinc-100">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <Radio className="w-5 h-5 text-zinc-300" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">{selectedSourceForDetail.name}</h3>
                  <div className="text-[11px] text-zinc-400 font-mono">{selectedSourceForDetail.endpoint}</div>
                </div>
              </div>
              <button
                onClick={() => setSelectedSourceForDetail(null)}
                className="text-zinc-400 hover:text-zinc-200 p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-0.5">
                <span className="text-[10px] uppercase text-zinc-400 font-bold">Total Imported</span>
                <div className="text-lg font-bold text-zinc-100">{selectedSourceForDetail.recordsImported.toLocaleString()}</div>
              </div>
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-0.5">
                <span className="text-[10px] uppercase text-zinc-400 font-bold">Success Rate</span>
                <div className="text-lg font-bold text-zinc-100">{selectedSourceForDetail.successRate}%</div>
              </div>
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-0.5">
                <span className="text-[10px] uppercase text-zinc-400 font-bold">Auth Protocol</span>
                <div className="text-xs font-mono text-zinc-200 truncate" title={selectedSourceForDetail.authMethod}>
                  {selectedSourceForDetail.authMethod}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="font-bold text-zinc-300 text-xs uppercase tracking-wider">Sync Execution History</h4>
              {(!selectedSourceForDetail.syncHistory || selectedSourceForDetail.syncHistory.length === 0) ? (
                <div className="p-6 text-center text-zinc-500 bg-zinc-950 rounded-xl border border-zinc-800">
                  No previous sync runs logged for this connector.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <table className="w-full text-left font-mono text-[11px]">
                    <thead className="bg-zinc-900 text-zinc-400 font-sans border-b border-zinc-800">
                      <tr>
                        <th className="py-2.5 px-3">Run ID</th>
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Records Fetched</th>
                        <th className="py-2.5 px-3">Duration</th>
                        <th className="py-2.5 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {selectedSourceForDetail.syncHistory.map(run => (
                        <tr key={run.id} className="hover:bg-zinc-900/40">
                          <td className="py-2.5 px-3 font-semibold text-zinc-300">{run.id}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{run.timestamp}</td>
                          <td className="py-2.5 px-3 font-sans font-bold text-zinc-200">+{run.recordsFetched.toLocaleString()}</td>
                          <td className="py-2.5 px-3 text-zinc-400">{run.duration}</td>
                          <td className="py-2.5 px-3 text-right font-sans">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">
                              {run.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <button
                onClick={() => onManualSync(selectedSourceForDetail.id)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Run Immediate Sync
              </button>
              <button
                onClick={() => setSelectedSourceForDetail(null)}
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
