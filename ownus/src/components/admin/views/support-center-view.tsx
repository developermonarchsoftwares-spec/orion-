'use client';

import React, { useState } from 'react';
import { 
  LifeBuoy, 
  Search, 
  PlusCircle, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ShieldAlert, 
  User, 
  Building2, 
  MoreVertical, 
  Eye, 
  Download,
  Filter,
  Layers,
  MessageSquare
} from 'lucide-react';
import { 
  SupportTicket, 
  TicketPriority, 
  TicketStatus 
} from '@/types/admin';
import { SupportTicketModal } from '@/components/admin/modals/support-ticket-modal';

interface SupportCenterViewProps {
  tickets: SupportTicket[];
  onUpdateTicketStatus: (ticketId: string, newStatus: TicketStatus, resolution?: string) => void;
  onAddTicketMessage: (ticketId: string, message: string, isInternalNote: boolean) => void;
  onCreateTicket?: (ticket: Omit<SupportTicket, 'id' | 'createdDate' | 'lastUpdated' | 'messages' | 'internalNotes'>) => void;
}

export const SupportCenterView: React.FC<SupportCenterViewProps> = ({
  tickets,
  onUpdateTicketStatus,
  onAddTicketMessage,
  onCreateTicket,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriority, setSelectedPriority] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedTicketForDetail, setSelectedTicketForDetail] = useState<SupportTicket | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New ticket form state
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [company, setCompany] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<SupportTicket['category']>('Billing & Credits');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [assignedTo, setAssignedTo] = useState('Orion Support');

  const filteredTickets = tickets.filter(ticket => {
    const matchesSearch = 
      ticket.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.subject.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPriority = selectedPriority === 'ALL' || ticket.priority === selectedPriority;
    const matchesStatus = selectedStatus === 'ALL' || ticket.status === selectedStatus;
    return matchesSearch && matchesPriority && matchesStatus;
  });

  // KPI Computations
  const openTicketsCount = tickets.filter(t => t.status === 'Open').length;
  const pendingTicketsCount = tickets.filter(t => t.status === 'In Progress' || t.status === 'Waiting for Customer').length;
  const resolvedTodayCount = tickets.filter(t => t.status === 'Resolved').length + 4;
  const avgResolutionTime = '2.4 Hours';

  const handleCreateTicketSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !onCreateTicket) return;

    onCreateTicket({
      customerId: 'CUST-1001',
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      company: company.trim(),
      subject: subject.trim(),
      priority,
      status: 'Open',
      assignedTo,
      category,
    });

    setSubject('');
    setShowCreateModal(false);
  };

  const getPriorityBadge = (priority: TicketPriority) => {
    switch (priority) {
      case 'Critical':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-zinc-900 text-zinc-100 border border-zinc-700">Critical</span>;
      case 'High':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">High</span>;
      case 'Medium':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-800">Medium</span>;
      case 'Low':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-800">Low</span>;
      default:
        return priority;
    }
  };

  const getStatusBadge = (status: TicketStatus) => {
    switch (status) {
      case 'Open':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700">Open</span>;
      case 'In Progress':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">In Progress</span>;
      case 'Waiting for Customer':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800/80 text-zinc-400 border border-zinc-800">Waiting for Customer</span>;
      case 'Resolved':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700">Resolved</span>;
      case 'Closed':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800">Closed</span>;
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
            <LifeBuoy className="w-5 h-5 text-zinc-300" />
            Support Center & Customer Helpdesk
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Manage subscriber queries, API webhook integration issues, data dispute tickets, credit refund requests, and SLA tracking.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow self-start md:self-auto"
        >
          <PlusCircle className="w-4 h-4" />
          Create Support Ticket
        </button>
      </div>

      {/* 4 Dashboard Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Open Tickets</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{openTicketsCount}</div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-zinc-300" /> Requires triage
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Pending Tickets</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{pendingTicketsCount}</div>
          <div className="text-xs text-zinc-400 mt-1">
            In progress with operators
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Resolved Today</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{resolvedTodayCount}</div>
          <div className="text-xs text-zinc-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> Met 100% SLA target
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-xs text-zinc-400 font-medium uppercase tracking-wider">Average Resolution Time</div>
          <div className="text-2xl font-bold text-zinc-100 mt-1">{avgResolutionTime}</div>
          <div className="text-xs text-zinc-400 mt-1">
            Enterprise SLA &lt; 4.0 Hours
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search tickets by ID, customer, subject..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={selectedPriority}
            onChange={e => setSelectedPriority(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>

          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Waiting for Customer">Waiting for Customer</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>

      {/* Support Tickets Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4">Ticket ID & Subject</th>
                <th className="py-3.5 px-4">Customer & Organization</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Priority</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Assigned To</th>
                <th className="py-3.5 px-4">Created Date</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono text-xs">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500 font-sans">
                    <LifeBuoy className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No support tickets match the filtered criteria.
                  </td>
                </tr>
              ) : (
                filteredTickets.map(ticket => (
                  <tr key={ticket.id} className="hover:bg-zinc-800/40 transition">
                    <td className="py-3.5 px-4 font-sans max-w-xs">
                      <div className="font-mono font-bold text-zinc-300 text-xs">{ticket.id}</div>
                      <div className="font-semibold text-zinc-100 text-sm truncate mt-0.5" title={ticket.subject}>
                        {ticket.subject}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      <div className="font-semibold text-zinc-200">{ticket.customerName}</div>
                      <div className="text-xs text-zinc-400">{ticket.company}</div>
                    </td>

                    <td className="py-3.5 px-4 font-sans text-zinc-300 text-xs">
                      {ticket.category}
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      {getPriorityBadge(ticket.priority)}
                    </td>

                    <td className="py-3.5 px-4 font-sans">
                      {getStatusBadge(ticket.status)}
                    </td>

                    <td className="py-3.5 px-4 font-sans text-zinc-300 text-xs">
                      {ticket.assignedTo}
                    </td>

                    <td className="py-3.5 px-4 text-zinc-400 text-xs">
                      {ticket.createdDate}
                    </td>

                    <td className="py-3.5 px-4 text-right font-sans">
                      <button
                        onClick={() => setSelectedTicketForDetail(ticket)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition flex items-center gap-1 ml-auto"
                        title="Open Ticket Conversation & Resolution"
                      >
                        <Eye className="w-3.5 h-3.5" /> View Ticket
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Support Ticket Details Modal */}
      {selectedTicketForDetail && (
        <SupportTicketModal
          ticket={selectedTicketForDetail}
          isOpen={!!selectedTicketForDetail}
          onClose={() => setSelectedTicketForDetail(null)}
          onUpdateTicketStatus={(ticketId, newStatus, resolution) => {
            onUpdateTicketStatus(ticketId, newStatus, resolution);
            setSelectedTicketForDetail(prev => prev ? { ...prev, status: newStatus, resolution } : null);
          }}
          onAddTicketMessage={(ticketId, message, isInternalNote) => {
            onAddTicketMessage(ticketId, message, isInternalNote);
            if (selectedTicketForDetail) {
              const newMsg = {
                id: `msg-${Date.now()}`,
                sender: 'Support Agent' as const,
                senderName: 'Orion Administrator',
                message,
                timestamp: 'Just now',
                isInternalNote
              };
              setSelectedTicketForDetail({
                ...selectedTicketForDetail,
                messages: [...selectedTicketForDetail.messages, newMsg]
              });
            }
          }}
        />
      )}

      {/* Create Support Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-zinc-300" />
                Create Support Ticket
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTicketSubmit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Customer Name</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Company</label>
                  <input
                    type="text"
                    required
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-zinc-400 mb-1">Subject / Issue Summary</label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="e.g. Lead phone number accuracy dispute in Pune cluster"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  >
                    <option value="Billing & Credits">Billing & Credits</option>
                    <option value="Data Accuracy">Data Accuracy</option>
                    <option value="Account Access">Account Access</option>
                    <option value="API Integration">API Integration</option>
                    <option value="Feature Request">Feature Request</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Priority</label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as any)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Assigned Agent</label>
                  <input
                    type="text"
                    value={assignedTo}
                    onChange={e => setAssignedTo(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition"
                >
                  Open Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
