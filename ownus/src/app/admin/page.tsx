'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  AdminTab, 
  AdminBusinessRecord, 
  BusinessStatus,
  ValidationStatus,
  ImportBatch, 
  DuplicatePair, 
  ValidationIssue, 
  ActivityLogEntry, 
  CustomerUser,
  TransactionRecord,
  RoleDefinition,
  SupportTicket,
  TicketStatus,
  PaymentStatus,
  CustomerPlan,
  DataSourceRecord,
  DataSourceStatus,
  EnrichmentJob,
  AiPipelineDefinition,
  AutomationRule,
  SystemServiceHealth,
  SearchIndexStatus
} from '@/types/admin';
import {
  INITIAL_ADMIN_BUSINESSES,
  INITIAL_IMPORT_BATCHES,
  INITIAL_DUPLICATES,
  INITIAL_VALIDATION_ISSUES,
  INITIAL_ACTIVITY_LOGS,
  INITIAL_CUSTOMER_USERS,
  INITIAL_PLATFORM_TRANSACTIONS,
  INITIAL_ROLES_PERMISSIONS,
  INITIAL_SUPPORT_TICKETS,
  INITIAL_DATA_SOURCES,
  INITIAL_ENRICHMENT_JOBS,
  INITIAL_AI_PIPELINES,
  INITIAL_AUTOMATION_RULES,
  INITIAL_SYSTEM_SERVICES,
  INITIAL_SEARCH_INDEX_STATUS,
} from '@/lib/admin-mock-data';

// Layout components
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { AdminHeader } from '@/components/admin/admin-header';

// View components - Module 1 & 2 & 3
import { AdminDashboardView } from '@/components/admin/views/admin-dashboard-view';
import { BusinessRecordsView } from '@/components/admin/views/business-records-view';
import { ImportDataView } from '@/components/admin/views/import-data-view';
import { ImportHistoryView } from '@/components/admin/views/import-history-view';
import { DataValidationView } from '@/components/admin/views/data-validation-view';
import { DuplicateManagerView } from '@/components/admin/views/duplicate-manager-view';
import { PublishQueueView } from '@/components/admin/views/publish-queue-view';
import { DataEnrichmentView } from '@/components/admin/views/data-enrichment-view';
import { PublishedBusinessesView } from '@/components/admin/views/published-businesses-view';
import { UsersManagementView } from '@/components/admin/views/users-management-view';
import { CreditsTransactionsView } from '@/components/admin/views/credits-transactions-view';
import { RolesPermissionsView } from '@/components/admin/views/roles-permissions-view';
import { ReportsView } from '@/components/admin/views/reports-view';
import { AdminSettingsView } from '@/components/admin/views/admin-settings-view';
import { ActivityLogsView } from '@/components/admin/views/activity-logs-view';
import { SupportCenterView } from '@/components/admin/views/support-center-view';

// View components - Module 4: Data Intelligence & Automation
import { DataSourcesView } from '@/components/admin/views/data-sources-view';
import { EnrichmentQueueView } from '@/components/admin/views/enrichment-queue-view';
import { AiProcessingView } from '@/components/admin/views/ai-processing-view';
import { AutomationRulesView } from '@/components/admin/views/automation-rules-view';
import { SyncCenterView } from '@/components/admin/views/sync-center-view';
import { SystemHealthView } from '@/components/admin/views/system-health-view';
import { DataIntelligenceView } from '@/components/admin/views/data-intelligence-view';

// Modal components
import { BusinessDetailsModal } from '@/components/admin/modals/business-details-modal';
import { BusinessValidationModal } from '@/components/admin/modals/business-validation-modal';
import { MergePreviewModal } from '@/components/admin/modals/merge-preview-modal';
import { GlobalAdminSearchModal } from '@/components/admin/modals/global-admin-search-modal';

export default function AdminPortalPage() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Core Data Stores
  const [records, setRecords] = useState<AdminBusinessRecord[]>(INITIAL_ADMIN_BUSINESSES);
  const [batches, setBatches] = useState<ImportBatch[]>(INITIAL_IMPORT_BATCHES);
  const [duplicatePairs, setDuplicatePairs] = useState<DuplicatePair[]>(INITIAL_DUPLICATES);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>(INITIAL_VALIDATION_ISSUES);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>(INITIAL_ACTIVITY_LOGS);
  const [customerUsers, setCustomerUsers] = useState<CustomerUser[]>(INITIAL_CUSTOMER_USERS);
  const [transactions, setTransactions] = useState<TransactionRecord[]>(INITIAL_PLATFORM_TRANSACTIONS);
  const [roles, setRoles] = useState<RoleDefinition[]>(INITIAL_ROLES_PERMISSIONS);
  const [tickets, setTickets] = useState<SupportTicket[]>(INITIAL_SUPPORT_TICKETS);

  // Module 4 Data Stores: Data Intelligence & Automation
  const [dataSources, setDataSources] = useState<DataSourceRecord[]>(INITIAL_DATA_SOURCES);
  const [enrichmentJobs, setEnrichmentJobs] = useState<EnrichmentJob[]>(INITIAL_ENRICHMENT_JOBS);
  const [aiPipelines, setAiPipelines] = useState<AiPipelineDefinition[]>(INITIAL_AI_PIPELINES);
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(INITIAL_AUTOMATION_RULES);
  const [systemServices, setSystemServices] = useState<SystemServiceHealth[]>(INITIAL_SYSTEM_SERVICES);
  const [searchIndexStatus, setSearchIndexStatus] = useState<SearchIndexStatus>(INITIAL_SEARCH_INDEX_STATUS);

  // Modal / Drawer States
  const [selectedRecordForDetail, setSelectedRecordForDetail] = useState<AdminBusinessRecord | null>(null);
  const [selectedRecordForValidation, setSelectedRecordForValidation] = useState<AdminBusinessRecord | null>(null);
  const [selectedDuplicatePair, setSelectedDuplicatePair] = useState<DuplicatePair | null>(null);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Keyboard shortcut for Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchModalOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute live counts for sidebar badges
  const counts = useMemo(() => {
    return {
      pendingReviews: records.filter(r => r.status === 'approved' || r.status === 'validated' || r.status === 'draft').length,
      duplicates: duplicatePairs.filter(p => p.status === 'pending').length,
      validationErrors: records.filter(r => r.validationStatus === 'Warning' || r.validationStatus === 'Rejected').length,
      failedImports: batches.filter(b => b.status === 'Failed' || b.status === 'Warning').length,
      openTickets: tickets.filter(t => t.status === 'Open').length,
    };
  }, [records, duplicatePairs, batches, tickets]);

  // Record Workflow Status Transition Handler
  const handleStatusChange = (recordId: string, newStatus: BusinessStatus) => {
    setRecords(prev => prev.map(rec => {
      if (rec.id === recordId) {
        return {
          ...rec,
          status: newStatus,
          validationStatus: newStatus === 'approved' || newStatus === 'published' ? 'Approved' : rec.validationStatus,
          updatedAt: new Date().toISOString(),
          approvedDate: newStatus === 'approved' || newStatus === 'published' ? new Date().toISOString().replace('T', ' ').slice(0, 16) : rec.approvedDate,
          reviewer: newStatus === 'approved' || newStatus === 'published' ? 'Vikramaditya Sethi' : rec.reviewer,
        };
      }
      return rec;
    }));

    if (selectedRecordForDetail && selectedRecordForDetail.id === recordId) {
      setSelectedRecordForDetail(prev => prev ? { ...prev, status: newStatus } : null);
    }
    if (selectedRecordForValidation && selectedRecordForValidation.id === recordId) {
      setSelectedRecordForValidation(prev => prev ? { ...prev, status: newStatus } : null);
    }

    const target = records.find(r => r.id === recordId);
    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: newStatus === 'published' ? 'Published' : newStatus === 'approved' ? 'Approved' : 'Updated',
      entityType: 'Business',
      entityId: recordId,
      entityName: target?.name || 'Business Record',
      details: `Status transitioned to "${newStatus.toUpperCase()}". Visible in Discover: ${newStatus === 'published' ? 'YES' : 'NO'}.`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);

    showToast(`Status updated to ${newStatus.toUpperCase()}`);
  };

  // Bulk Status Update Handler
  const handleBulkStatusChange = (ids: string[], newStatus: BusinessStatus) => {
    setRecords(prev => prev.map(rec => {
      if (ids.includes(rec.id)) {
        return {
          ...rec,
          status: newStatus,
          validationStatus: newStatus === 'approved' || newStatus === 'published' ? 'Approved' : rec.validationStatus,
          updatedAt: new Date().toISOString(),
          approvedDate: newStatus === 'approved' || newStatus === 'published' ? new Date().toISOString().replace('T', ' ').slice(0, 16) : rec.approvedDate,
          reviewer: newStatus === 'approved' || newStatus === 'published' ? 'Vikramaditya Sethi' : rec.reviewer,
        };
      }
      return rec;
    }));

    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: newStatus === 'published' ? 'Published' : 'Updated',
      entityType: 'Business',
      entityId: 'BULK_BATCH',
      entityName: `${ids.length} Business Records`,
      details: `Bulk status update applied: "${newStatus.toUpperCase()}" on ${ids.length} records.`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);

    showToast(`Bulk updated ${ids.length} records to ${newStatus.toUpperCase()}`);
  };

  // Bulk Delete Handler
  const handleBulkDelete = (ids: string[]) => {
    setRecords(prev => prev.filter(r => !ids.includes(r.id)));
    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: 'Deleted',
      entityType: 'Business',
      entityId: 'BULK_DELETE',
      entityName: `${ids.length} Business Records`,
      details: `Bulk deleted ${ids.length} records from repository.`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);
    showToast(`Deleted ${ids.length} business records.`);
  };

  const handleApproveRecord = (id: string) => {
    handleStatusChange(id, 'approved');
  };

  const handleRejectRecord = (id: string) => {
    setRecords(prev => prev.map(rec => {
      if (rec.id === id) {
        return {
          ...rec,
          status: 'rejected',
          validationStatus: 'Rejected',
          updatedAt: new Date().toISOString(),
        };
      }
      return rec;
    }));

    if (selectedRecordForValidation && selectedRecordForValidation.id === id) {
      setSelectedRecordForValidation(null);
    }

    const target = records.find(r => r.id === id);
    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: 'Rejected',
      entityType: 'Business',
      entityId: id,
      entityName: target?.name || 'Business Record',
      details: `Rejected business entity from publication queue.`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);
    showToast(`Record ${id} rejected.`);
  };

  const handleDeleteRecord = (id: string) => {
    setRecords(prev => prev.filter(r => r.id !== id));
    if (selectedRecordForValidation && selectedRecordForValidation.id === id) {
      setSelectedRecordForValidation(null);
    }
    showToast(`Record ${id} deleted.`);
  };

  const handleMoveToDraft = (id: string) => {
    handleStatusChange(id, 'draft');
  };

  const handleBulkApproveValidation = (ids: string[]) => {
    handleBulkStatusChange(ids, 'approved');
  };

  const handleBulkRejectValidation = (ids: string[]) => {
    setRecords(prev => prev.map(rec => {
      if (ids.includes(rec.id)) {
        return {
          ...rec,
          status: 'rejected',
          validationStatus: 'Rejected',
          updatedAt: new Date().toISOString(),
        };
      }
      return rec;
    }));
    showToast(`Rejected ${ids.length} records.`);
  };

  const handleExportRecords = (exportList: AdminBusinessRecord[]) => {
    const headers = ['ID', 'Name', 'Industry', 'Category', 'City', 'State', 'Phone', 'Email', 'Website', 'Status', 'Quality Score'];
    const rows = exportList.map(r => [
      r.id,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.industry}"`,
      `"${r.category}"`,
      `"${r.city}"`,
      `"${r.state}"`,
      r.phone,
      r.email,
      r.website,
      r.status,
      r.dataQualityScore,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `orion_business_records_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${exportList.length} records to CSV.`);
  };

  const handleSaveNotes = (id: string, note: string) => {
    setRecords(prev => prev.map(r => {
      if (r.id === id) {
        return {
          ...r,
          internalNotes: [...(r.internalNotes || []), note]
        };
      }
      return r;
    }));
    showToast('Internal operator note added.');
  };

  const handleCompleteImport = (batchSummary: any) => {
    const newBatch: ImportBatch = {
      id: `IMP-${Math.floor(1000 + Math.random() * 9000)}`,
      fileName: batchSummary.fileName || 'Ingested_Data_File.csv',
      uploadedBy: 'Priya Sharma (Data Ops)',
      uploadedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      totalRecords: batchSummary.total || 14200,
      successCount: batchSummary.success || 13850,
      failedCount: batchSummary.failed || 120,
      duplicateCount: batchSummary.duplicates || 230,
      status: 'Completed',
      fileSize: '4.8 MB',
    };

    setBatches(prev => [newBatch, ...prev]);

    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: newBatch.uploadedBy,
      action: 'Imported',
      entityType: 'Batch',
      entityId: newBatch.id,
      entityName: newBatch.fileName,
      details: `Batch ingestion completed: ${newBatch.totalRecords} total records (${newBatch.successCount} valid, ${newBatch.duplicateCount} duplicates, ${newBatch.failedCount} errors).`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);

    showToast(`Successfully ingested batch: ${newBatch.fileName}`);
    setActiveTab('history');
  };

  // Duplicates Handlers
  const handleMergeDuplicateConfirm = (pairId: string, mergedRecord: AdminBusinessRecord) => {
    const pair = duplicatePairs.find(p => p.id === pairId);
    if (!pair) return;

    setRecords(prev => {
      const filtered = prev.filter(r => r.id !== pair.duplicate.id);
      return filtered.map(r => r.id === mergedRecord.id ? mergedRecord : r);
    });

    setDuplicatePairs(prev => prev.map(p => p.id === pairId ? { ...p, status: 'merged' } : p));
    setSelectedDuplicatePair(null);

    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: 'Merged',
      entityType: 'Business',
      entityId: mergedRecord.id,
      entityName: mergedRecord.name,
      details: `Resolved duplicate conflict: merged "${pair.duplicate.name}" into master entity "${mergedRecord.name}".`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);

    showToast(`Merged duplicate pair into "${mergedRecord.name}"`);
  };

  const handleKeepOriginal = (pairId: string) => {
    const pair = duplicatePairs.find(p => p.id === pairId);
    if (!pair) return;
    setRecords(prev => prev.filter(r => r.id !== pair.duplicate.id));
    setDuplicatePairs(prev => prev.map(p => p.id === pairId ? { ...p, status: 'deleted' } : p));
    showToast('Preserved master original record and removed duplicate.');
  };

  const handleKeepNew = (pairId: string) => {
    const pair = duplicatePairs.find(p => p.id === pairId);
    if (!pair) return;
    setRecords(prev => prev.map(r => r.id === pair.original.id ? { ...pair.duplicate, id: pair.original.id } : r));
    setDuplicatePairs(prev => prev.map(p => p.id === pairId ? { ...p, status: 'merged' } : p));
    showToast('Updated master record with incoming candidate attributes.');
  };

  const handleIgnoreDuplicate = (pairId: string) => {
    setDuplicatePairs(prev => prev.map(p => p.id === pairId ? { ...p, status: 'ignored' } : p));
    showToast('Ignored duplicate collision (marked as false-positive).');
  };

  const handleDeleteDuplicate = (pairId: string) => {
    const pair = duplicatePairs.find(p => p.id === pairId);
    if (!pair) return;
    setRecords(prev => prev.filter(r => r.id !== pair.duplicate.id));
    setDuplicatePairs(prev => prev.map(p => p.id === pairId ? { ...p, status: 'deleted' } : p));
    showToast('Deleted duplicate candidate record.');
  };

  const handleBulkMergeDuplicates = (pairIds: string[]) => {
    pairIds.forEach(id => {
      const pair = duplicatePairs.find(p => p.id === id);
      if (pair) {
        setRecords(prev => prev.filter(r => r.id !== pair.duplicate.id));
      }
    });
    setDuplicatePairs(prev => prev.map(p => pairIds.includes(p.id) ? { ...p, status: 'merged' } : p));
    showToast(`Bulk auto-merged ${pairIds.length} duplicate pairs.`);
  };

  // ================= MODULE 3 HANDLERS ================= //

  // Customer User Handlers
  const handleUpdateCustomer = (updatedUser: CustomerUser) => {
    setCustomerUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
    showToast(`Updated customer profile for ${updatedUser.name}`);
  };

  const handleAddCustomer = (newUser: Omit<CustomerUser, 'id'>) => {
    const created: CustomerUser = {
      ...newUser,
      id: `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
    };
    setCustomerUsers(prev => [created, ...prev]);

    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: 'Created',
      entityType: 'User',
      entityId: created.id,
      entityName: created.name,
      details: `Created new customer account (${created.plan} plan, ${created.credits} credits).`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);

    showToast(`Customer account created for ${created.name}`);
  };

  const handleDeleteCustomer = (userId: string) => {
    setCustomerUsers(prev => prev.filter(u => u.id !== userId));
    showToast(`Customer account ${userId} deleted.`);
  };

  // Credit Transaction Handlers
  const handleAddTransaction = (tx: Omit<TransactionRecord, 'id' | 'date' | 'receiptNumber'>) => {
    const created: TransactionRecord = {
      ...tx,
      id: `TXN-${Math.floor(100000 + Math.random() * 900000)}`,
      receiptNumber: `REC-2024-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString().replace('T', ' ').slice(0, 16),
    };
    setTransactions(prev => [created, ...prev]);

    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Automated Payment Gateway',
      action: 'Created',
      entityType: 'Credits',
      entityId: created.id,
      entityName: `${created.customerName} (${created.creditsPurchased} Credits)`,
      details: `Transaction posted: ₹${created.amount} via ${created.paymentMethod} (${created.paymentStatus}).`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);

    showToast(`Transaction ${created.id} recorded successfully.`);
  };

  const handleUpdateTransactionStatus = (id: string, newStatus: PaymentStatus, reason?: string) => {
    setTransactions(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          paymentStatus: newStatus,
          refundReason: reason || t.refundReason,
        };
      }
      return t;
    }));
    showToast(`Transaction ${id} status updated to ${newStatus}`);
  };

  // Role Matrix Handlers
  const handleUpdateRole = (updatedRole: RoleDefinition) => {
    setRoles(prev => prev.map(r => r.id === updatedRole.id ? updatedRole : r));
    const newLog: ActivityLogEntry = {
      id: `act-${Date.now()}`,
      user: 'Vikramaditya Sethi (Super Admin)',
      action: 'Updated',
      entityType: 'Settings',
      entityId: updatedRole.id,
      entityName: `${updatedRole.name} Permissions Matrix`,
      details: `Updated granular access permissions across 12 modules.`,
      ipAddress: '192.168.1.1',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    setActivityLogs(prev => [newLog, ...prev]);
    showToast(`Saved permissions matrix for ${updatedRole.name}`);
  };

  const handleCreateRole = (newRole: Omit<RoleDefinition, 'id'>) => {
    const created: RoleDefinition = {
      ...newRole,
      id: `role-${Date.now().toString().slice(-4)}`,
    };
    setRoles(prev => [...prev, created]);
    showToast(`Created custom role: ${created.name}`);
  };

  // Support Ticket Handlers
  const handleUpdateTicketStatus = (ticketId: string, newStatus: TicketStatus, resolution?: string) => {
    setTickets(prev => prev.map(t => {
      if (t.id === ticketId) {
        return {
          ...t,
          status: newStatus,
          resolution: resolution || t.resolution,
          lastUpdated: new Date().toISOString().replace('T', ' ').slice(0, 16),
        };
      }
      return t;
    }));
    showToast(`Support Ticket ${ticketId} marked as ${newStatus}`);
  };

  const handleAddTicketMessage = (ticketId: string, messageText: string, isInternalNote: boolean) => {
    setTickets(prev => prev.map(t => {
      if (t.id === ticketId) {
        const newMsg = {
          id: `msg-${Date.now()}`,
          sender: isInternalNote ? ('Support Agent' as const) : ('Support Agent' as const),
          senderName: 'Vikramaditya Sethi',
          message: messageText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isInternalNote
        };
        return {
          ...t,
          messages: [...t.messages, newMsg],
          internalNotes: isInternalNote ? [...(t.internalNotes || []), messageText] : t.internalNotes,
          lastUpdated: new Date().toISOString().replace('T', ' ').slice(0, 16),
        };
      }
      return t;
    }));
    showToast('Message sent to ticket timeline.');
  };

  const handleCreateTicket = (newTicket: Omit<SupportTicket, 'id' | 'createdDate' | 'lastUpdated' | 'messages' | 'internalNotes'>) => {
    const created: SupportTicket = {
      ...newTicket,
      id: `TCK-${Math.floor(100 + Math.random() * 900)}`,
      createdDate: new Date().toISOString().replace('T', ' ').slice(0, 16),
      lastUpdated: new Date().toISOString().replace('T', ' ').slice(0, 16),
      messages: [
        {
          id: `msg-${Date.now()}`,
          sender: 'Customer',
          senderName: newTicket.customerName,
          message: newTicket.subject,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }
      ],
      internalNotes: ['Ticket initiated by administrator.']
    };
    setTickets(prev => [created, ...prev]);
    showToast(`Opened Support Ticket ${created.id}`);
  };

  // ================= MODULE 4 HANDLERS ================= //

  // Data Sources Handlers
  const handleUpdateDataSourceStatus = (sourceId: string, status: DataSourceStatus) => {
    setDataSources(prev => prev.map(s => s.id === sourceId ? { ...s, status } : s));
    showToast(`Data source ${sourceId} status updated to ${status}`);
  };

  const handleManualSyncSource = (sourceId: string) => {
    setDataSources(prev => prev.map(s => {
      if (s.id === sourceId) {
        return {
          ...s,
          status: 'Running',
          lastSync: 'Just now',
          recordsImported: s.recordsImported + 450,
          syncHistory: [
            {
              id: `SYNC-${Date.now().toString().slice(-4)}`,
              timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
              recordsFetched: 450,
              duration: '14s',
              status: 'Success',
              details: 'Manual trigger delta sync completed successfully.'
            },
            ...s.syncHistory
          ]
        };
      }
      return s;
    }));
    showToast(`Initiated manual sync for data source ${sourceId}`);
  };

  // Enrichment Queue Handlers
  const handleRetryEnrichmentJob = (jobId: string) => {
    setEnrichmentJobs(prev => prev.map(j => {
      if (j.id === jobId) {
        return {
          ...j,
          status: 'Running',
          progress: 25,
          errorMessage: undefined
        };
      }
      return j;
    }));
    showToast(`Retrying enrichment job ${jobId}`);
  };

  const handleCancelEnrichmentJob = (jobId: string) => {
    setEnrichmentJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'Skipped' } : j));
    showToast(`Cancelled enrichment job ${jobId}`);
  };

  const handleRunAllEnrichment = () => {
    setEnrichmentJobs(prev => prev.map(j => j.status === 'Queued' ? { ...j, status: 'Running', progress: 20 } : j));
    showToast('Enqueued all pending enrichment tasks to BullMQ workers.');
  };

  // Automation Rules Handlers
  const handleCreateAutomationRule = (ruleData: Omit<AutomationRule, 'id' | 'executionsCount' | 'successRate' | 'lastExecuted'>) => {
    const newRule: AutomationRule = {
      ...ruleData,
      id: `RULE-${String(automationRules.length + 1).padStart(2, '0')}`,
      executionsCount: 0,
      successRate: 100.0,
      lastExecuted: 'Never'
    };
    setAutomationRules(prev => [newRule, ...prev]);
    showToast(`Created automation rule ${newRule.name}`);
  };

  const handleUpdateAutomationRule = (rule: AutomationRule) => {
    setAutomationRules(prev => prev.map(r => r.id === rule.id ? rule : r));
    showToast(`Updated automation rule ${rule.name}`);
  };

  const handleDeleteAutomationRule = (id: string) => {
    setAutomationRules(prev => prev.filter(r => r.id !== id));
    showToast(`Deleted automation rule ${id}`);
  };

  const handleToggleRuleStatus = (id: string) => {
    setAutomationRules(prev => prev.map(r => {
      if (r.id === id) {
        const nextStatus = r.status === 'Active' ? 'Paused' : 'Active';
        return { ...r, status: nextStatus };
      }
      return r;
    }));
    showToast(`Toggled automation rule status.`);
  };

  const handleRunRuleDryRun = (id: string) => {
    setAutomationRules(prev => prev.map(r => {
      if (r.id === id) {
        return {
          ...r,
          executionsCount: r.executionsCount + 1,
          lastExecuted: 'Just now'
        };
      }
      return r;
    }));
    showToast(`Executed dry-run for rule ${id}. Policy condition satisfied.`);
  };

  // Sync Center Handlers
  const handleRebuildIndex = () => {
    setSearchIndexStatus(prev => ({
      ...prev,
      lastOptimized: 'Just now',
      pendingIndex: 0,
      failedIndex: 0
    }));
    showToast('Rebuilt Elasticsearch master indices & invalidated Discover facet cache.');
  };

  const handleOptimizeIndex = () => {
    setSearchIndexStatus(prev => ({
      ...prev,
      lastOptimized: 'Just now'
    }));
    showToast('Optimized Lucene shard segments. Search latency optimized.');
  };

  const handleFlushCache = () => {
    showToast('Flushed Redis in-memory search caches across all regions.');
  };

  // System Health Handlers
  const handleRestartService = (id: string) => {
    setSystemServices(prev => prev.map(s => {
      if (s.id === id) {
        return {
          ...s,
          status: 'Healthy',
          uptime: '100.0%',
          errorRate: '0.00%',
          cpuUsage: Math.floor(20 + Math.random() * 20),
          memoryUsage: Math.floor(30 + Math.random() * 25)
        };
      }
      return s;
    }));
    showToast(`Successfully restarted microservice pod ${id}`);
  };

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border border-zinc-700 dark:border-zinc-300 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-5">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Sticky Collapsible Sidebar */}
      <AdminSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        badgeCounts={counts}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(prev => !prev)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Sticky Header */}
        <AdminHeader
          activeTab={activeTab}
          onOpenSearch={() => setIsSearchModalOpen(true)}
          onNavigateTab={setActiveTab}
          onRefreshData={() => showToast('Platform synchronized with enterprise cluster.')}
        />

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          <div className="max-w-7xl mx-auto min-w-0">
            {/* Module 1 Views */}
            {activeTab === 'dashboard' && (
              <AdminDashboardView
                businesses={records}
                batches={batches}
                logs={activityLogs}
                onNavigate={setActiveTab}
                onSelectBusiness={setSelectedRecordForDetail}
              />
            )}

            {activeTab === 'records' && (
              <BusinessRecordsView
                businesses={records}
                onSelectBusiness={setSelectedRecordForDetail}
                onUpdateStatus={handleStatusChange}
                onBulkUpdateStatus={handleBulkStatusChange}
                onBulkDelete={handleBulkDelete}
                onExportRecords={handleExportRecords}
              />
            )}

            {activeTab === 'import' && (
              <ImportDataView
                onImportComplete={handleCompleteImport}
              />
            )}

            {activeTab === 'history' && (
              <ImportHistoryView
                batches={batches}
                onRetryBatch={batchId => showToast(`Retrying batch ${batchId}...`)}
                onDeleteBatch={batchId => {
                  setBatches(prev => prev.filter(b => b.id !== batchId));
                  showToast(`Batch ${batchId} deleted.`);
                }}
              />
            )}

            {/* Module 2 Views */}
            {activeTab === 'validation' && (
              <DataValidationView
                records={records}
                onViewDetails={setSelectedRecordForValidation}
                onApproveRecord={handleApproveRecord}
                onRejectRecord={handleRejectRecord}
                onDeleteRecord={handleDeleteRecord}
                onBulkApprove={handleBulkApproveValidation}
                onBulkReject={handleBulkRejectValidation}
                onBulkDelete={handleBulkDelete}
              />
            )}

            {activeTab === 'duplicates' && (
              <DuplicateManagerView
                duplicates={duplicatePairs}
                onOpenMergePreview={setSelectedDuplicatePair}
                onKeepOriginal={handleKeepOriginal}
                onKeepNew={handleKeepNew}
                onIgnore={handleIgnoreDuplicate}
                onDeleteDuplicate={handleDeleteDuplicate}
                onBulkMerge={handleBulkMergeDuplicates}
              />
            )}

            {activeTab === 'publish_queue' && (
              <PublishQueueView
                records={records}
                onViewRecord={setSelectedRecordForValidation}
                onStatusChange={handleStatusChange}
                onBulkStatusChange={handleBulkStatusChange}
                onBulkDelete={handleBulkDelete}
              />
            )}

            {activeTab === 'enrichment' && (
              <DataEnrichmentView />
            )}

            {activeTab === 'published' && (
              <PublishedBusinessesView
                records={records}
                onViewRecord={setSelectedRecordForDetail}
                onStatusChange={handleStatusChange}
              />
            )}

            {/* Module 3 Views: Platform Administration */}
            {activeTab === 'reports' && (
              <ReportsView records={records} />
            )}

            {activeTab === 'users' && (
              <UsersManagementView
                users={customerUsers}
                onUpdateUser={handleUpdateCustomer}
                onAddUser={handleAddCustomer}
                onDeleteUser={handleDeleteCustomer}
              />
            )}

            {activeTab === 'credits' && (
              <CreditsTransactionsView
                transactions={transactions}
                onAddTransaction={handleAddTransaction}
                onUpdateTransactionStatus={handleUpdateTransactionStatus}
              />
            )}

            {activeTab === 'roles' && (
              <RolesPermissionsView
                roles={roles}
                onUpdateRole={handleUpdateRole}
                onCreateRole={handleCreateRole}
              />
            )}

            {activeTab === 'settings' && (
              <AdminSettingsView />
            )}

            {activeTab === 'logs' && (
              <ActivityLogsView logs={activityLogs} />
            )}

            {activeTab === 'support' && (
              <SupportCenterView
                tickets={tickets}
                onUpdateTicketStatus={handleUpdateTicketStatus}
                onAddTicketMessage={handleAddTicketMessage}
                onCreateTicket={handleCreateTicket}
              />
            )}

            {/* Module 4 Views: Data Intelligence & Automation */}
            {activeTab === 'data_intelligence' && (
              <DataIntelligenceView
                records={records}
                sources={dataSources}
                enrichmentJobs={enrichmentJobs}
                pipelines={aiPipelines}
                rules={automationRules}
                systemServices={systemServices}
                onNavigateTab={setActiveTab}
                onSelectBusiness={setSelectedRecordForDetail}
              />
            )}

            {activeTab === 'sources' && (
              <DataSourcesView
                sources={dataSources}
                onUpdateStatus={handleUpdateDataSourceStatus}
                onManualSync={handleManualSyncSource}
              />
            )}

            {activeTab === 'enrichment_queue' && (
              <EnrichmentQueueView
                jobs={enrichmentJobs}
                onRetryJob={handleRetryEnrichmentJob}
                onCancelJob={handleCancelEnrichmentJob}
                onRunAll={handleRunAllEnrichment}
              />
            )}

            {activeTab === 'ai_processing' && (
              <AiProcessingView
                pipelines={aiPipelines}
              />
            )}

            {activeTab === 'automation' && (
              <AutomationRulesView
                rules={automationRules}
                onCreateRule={handleCreateAutomationRule}
                onUpdateRule={handleUpdateAutomationRule}
                onDeleteRule={handleDeleteAutomationRule}
                onToggleStatus={handleToggleRuleStatus}
                onRunRuleNow={handleRunRuleDryRun}
              />
            )}

            {activeTab === 'sync_center' && (
              <SyncCenterView
                indexStatus={searchIndexStatus}
                onRebuildIndex={handleRebuildIndex}
                onOptimizeIndex={handleOptimizeIndex}
                onFlushCache={handleFlushCache}
              />
            )}

            {activeTab === 'system_health' && (
              <SystemHealthView
                services={systemServices}
                onRestartService={handleRestartService}
                onRefreshHealth={() => showToast('Polled latest telemetry from Kubernetes & Prometheus.')}
              />
            )}
          </div>
        </main>
      </div>

      {/* Global Business Record Detail Drawer / Modal */}
      {selectedRecordForDetail && (
        <BusinessDetailsModal
          business={selectedRecordForDetail}
          isOpen={!!selectedRecordForDetail}
          onClose={() => setSelectedRecordForDetail(null)}
          onUpdateStatus={handleStatusChange}
          onSaveNotes={handleSaveNotes}
        />
      )}

      {/* Module 2 Business Validation Details Modal */}
      {selectedRecordForValidation && (
        <BusinessValidationModal
          business={selectedRecordForValidation}
          isOpen={!!selectedRecordForValidation}
          onClose={() => setSelectedRecordForValidation(null)}
          onApprove={handleApproveRecord}
          onReject={handleRejectRecord}
          onMoveToDraft={handleMoveToDraft}
          onDelete={handleDeleteRecord}
          onSaveNote={handleSaveNotes}
        />
      )}

      {/* Side-by-Side Merge Preview Modal */}
      {selectedDuplicatePair && (
        <MergePreviewModal
          pair={selectedDuplicatePair}
          isOpen={!!selectedDuplicatePair}
          onClose={() => setSelectedDuplicatePair(null)}
          onConfirmMerge={handleMergeDuplicateConfirm}
        />
      )}

      {/* Global Admin Search Modal (Cmd+K across all 5 entities) */}
      {isSearchModalOpen && (
        <GlobalAdminSearchModal
          isOpen={isSearchModalOpen}
          onClose={() => setIsSearchModalOpen(false)}
          businesses={records}
          users={customerUsers}
          transactions={transactions}
          tickets={tickets}
          logs={activityLogs}
          onSelectBusiness={business => {
            setSelectedRecordForDetail(business);
            setIsSearchModalOpen(false);
          }}
          onSelectUser={user => {
            setActiveTab('users');
            setIsSearchModalOpen(false);
          }}
          onSelectTicket={ticket => {
            setActiveTab('support');
            setIsSearchModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
