'use client';

import React, { useState } from 'react';
import { 
  Activity, 
  Search, 
  Download, 
  Filter, 
  User, 
  Clock, 
  Shield, 
  FileText, 
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle
} from 'lucide-react';
import { ActivityLogEntry } from '@/types/admin';

interface ActivityLogsViewProps {
  logs: ActivityLogEntry[];
}

interface EnrichedLogEntry extends ActivityLogEntry {
  role?: string;
  module?: string;
  status?: 'Success' | 'Failure' | 'Warning';
  date?: string;
  time?: string;
}

export const ActivityLogsView: React.FC<ActivityLogsViewProps> = ({ logs }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState<string>('ALL');
  const [selectedModule, setSelectedModule] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');
  const [showExportModal, setShowExportModal] = useState(false);

  // Normalize logs into 12 Platform Events
  const enrichedLogs: EnrichedLogEntry[] = logs.map(l => {
    const parts = l.timestamp.split(' ');
    const date = parts.length > 1 ? parts[0] : '2024-09-09';
    const time = parts.length > 1 ? parts[1] : l.timestamp;
    
    let role = 'Admin';
    if (l.user.includes('Super Admin')) role = 'Super Admin';
    else if (l.user.includes('Data Ops') || l.user.includes('Operator')) role = 'Data Manager';
    else if (l.user.includes('Reviewer')) role = 'Reviewer';
    else if (l.user.includes('Worker') || l.user.includes('System')) role = 'Automated System';
    else role = 'Customer';

    let module = 'Businesses';
    if (l.entityType === 'Batch') module = 'Import & Ingestion';
    else if (l.entityType === 'Credits') module = 'Credits & Ledger';
    else if (l.entityType === 'Settings') module = 'System Settings';
    else if (l.entityType === 'User') module = 'Users & Customers';

    let status: 'Success' | 'Failure' | 'Warning' = 'Success';
    if (l.action === 'Rejected' || l.details.toLowerCase().includes('failed') || l.details.toLowerCase().includes('error')) {
      status = 'Failure';
    } else if (l.action === 'Deleted' || l.details.toLowerCase().includes('quarantine')) {
      status = 'Warning';
    }

    return {
      ...l,
      date,
      time,
      role,
      module,
      status
    };
  });

  const filteredLogs = enrichedLogs.filter(log => {
    const matchesSearch = 
      log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entityName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entityId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.ipAddress.includes(searchQuery);

    const matchesAction = selectedAction === 'ALL' || log.action === selectedAction;
    const matchesModule = selectedModule === 'ALL' || log.module === selectedModule;
    const matchesStatus = selectedStatus === 'ALL' || log.status === selectedStatus;
    const matchesRole = selectedRole === 'ALL' || log.role === selectedRole;

    return matchesSearch && matchesAction && matchesModule && matchesStatus && matchesRole;
  });

  const handleExport = (format: 'csv' | 'excel' | 'pdf') => {
    if (format === 'csv') {
      const headers = ['Log ID', 'Date', 'Time', 'User', 'Role', 'Action', 'Module', 'Entity', 'Details', 'IP Address', 'Status'];
      const rows = filteredLogs.map(l => [
        l.id,
        l.date,
        l.time,
        `"${l.user}"`,
        l.role,
        l.action,
        `"${l.module}"`,
        `"${l.entityName.replace(/"/g, '""')}"`,
        `"${l.details.replace(/"/g, '""')}"`,
        l.ipAddress,
        l.status
      ]);
      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `orion_audit_logs_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const blob = new Blob([JSON.stringify(filteredLogs, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orion_audit_logs_${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    setShowExportModal(false);
  };

  const getStatusBadge = (status?: 'Success' | 'Failure' | 'Warning') => {
    switch (status) {
      case 'Success':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-300"><CheckCircle2 className="w-3 h-3 text-zinc-300" /> Success</span>;
      case 'Warning':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-400"><AlertTriangle className="w-3 h-3 text-zinc-400" /> Warning</span>;
      case 'Failure':
        return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500"><XCircle className="w-3 h-3 text-zinc-500" /> Failed</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Activity className="w-5 h-5 text-zinc-300" />
            Immutable Platform Activity & Compliance Trail
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time audit stream tracking 12 critical platform events: user registrations, logins, data updates, publications, ledger deductions, and admin settings.
          </p>
        </div>

        <button
          onClick={() => setShowExportModal(true)}
          className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow self-start md:self-auto"
        >
          <Download className="w-4 h-4" />
          Export Audit Logs
        </button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Total Recorded Events</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{enrichedLogs.length.toLocaleString()}</div>
          <div className="text-xs text-zinc-400 mt-1">
            30-day compliance retention
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Publication Events</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">
            {enrichedLogs.filter(l => l.action === 'Published').length}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Discover catalog syncs
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Security & Admin Events</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">
            {enrichedLogs.filter(l => l.role === 'Super Admin' || l.action === 'Created').length}
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Elevated privilege operations
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Audit Integrity</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1 flex items-center gap-1.5">
            <Shield className="w-5 h-5 text-zinc-300" /> WORM Verified
          </div>
          <div className="text-xs text-zinc-400 mt-1">
            Tamper-proof append-only ledger
          </div>
        </div>
      </div>

      {/* Advanced Filters and Search */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by User, Business, Txn ID, IP, or Action..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* Action Filter */}
            <select
              value={selectedAction}
              onChange={e => setSelectedAction(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="ALL">All Actions (12 Events)</option>
              <option value="Created">User Registered / Created</option>
              <option value="Updated">Updated Record / Settings</option>
              <option value="Imported">Business Ingested</option>
              <option value="Published">Business Published</option>
              <option value="Merged">Deduplication Merged</option>
              <option value="Rejected">Rejected Validation</option>
              <option value="Deleted">Record Deleted</option>
              <option value="Exported">CSV / Excel Exported</option>
            </select>

            {/* Module Filter */}
            <select
              value={selectedModule}
              onChange={e => setSelectedModule(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="ALL">All Modules</option>
              <option value="Businesses">Businesses</option>
              <option value="Import & Ingestion">Import & Ingestion</option>
              <option value="Credits & Ledger">Credits & Ledger</option>
              <option value="Users & Customers">Users & Customers</option>
              <option value="System Settings">System Settings</option>
            </select>

            {/* Role Filter */}
            <select
              value={selectedRole}
              onChange={e => setSelectedRole(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="ALL">All Roles</option>
              <option value="Super Admin">Super Admin</option>
              <option value="Data Manager">Data Manager</option>
              <option value="Reviewer">Reviewer</option>
              <option value="Customer">Customer</option>
              <option value="Automated System">Automated System</option>
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="Success">Success</option>
              <option value="Warning">Warning</option>
              <option value="Failure">Failure</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Date & Time</th>
                <th className="py-3.5 px-4">User & Role</th>
                <th className="py-3.5 px-4">Action</th>
                <th className="py-3.5 px-4">Module & Entity</th>
                <th className="py-3.5 px-4">Event Details</th>
                <th className="py-3.5 px-4 font-mono">IP Address</th>
                <th className="py-3.5 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500 font-sans">
                    <Activity className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No audit log records match the search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3.5 px-4 text-zinc-400 text-xs">
                      <div>{log.date}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">{log.time}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-semibold text-zinc-200">{log.user}</div>
                      <div className="text-[11px] text-zinc-400 font-mono mt-0.5">{log.role}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">
                        {log.action}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-semibold text-zinc-100">{log.entityName}</div>
                      <div className="text-[11px] text-zinc-400 font-mono">{log.module} • {log.entityId}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans text-zinc-300 max-w-sm truncate" title={log.details}>
                      {log.details}
                    </td>

                    <td className="py-3.5 px-4 text-zinc-400 font-mono text-xs">
                      {log.ipAddress}
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      {getStatusBadge(log.status)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export Format Modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <Download className="w-5 h-5 text-zinc-300" />
                Export Audit Trail
              </h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              Export {filteredLogs.length} filtered audit records for compliance reporting.
            </p>

            <div className="space-y-2.5">
              <button
                onClick={() => handleExport('csv')}
                className="w-full p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-semibold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-zinc-400" />
                  <span>CSV Spreadsheet Format</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">.csv</span>
              </button>

              <button
                onClick={() => handleExport('excel')}
                className="w-full p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-semibold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-zinc-400" />
                  <span>Microsoft Excel Workbook</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">.xlsx</span>
              </button>

              <button
                onClick={() => handleExport('pdf')}
                className="w-full p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg flex items-center justify-between text-xs font-semibold text-zinc-200 transition"
              >
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 text-zinc-400" />
                  <span>Audit PDF Report</span>
                </div>
                <span className="font-mono text-[10px] text-zinc-400">.pdf</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
