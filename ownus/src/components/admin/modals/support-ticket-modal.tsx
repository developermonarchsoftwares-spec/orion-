'use client';

import React, { useState } from 'react';
import { 
  SupportTicket, 
  TicketStatus, 
  TicketPriority,
  SupportTicketMessage
} from '@/types/admin';
import { 
  X, 
  LifeBuoy, 
  Send, 
  Lock, 
  CheckCircle2, 
  Clock, 
  User, 
  Building2, 
  Paperclip, 
  AlertCircle, 
  ShieldAlert, 
  MessageSquare,
  FileText
} from 'lucide-react';

interface SupportTicketModalProps {
  ticket: SupportTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTicketStatus: (ticketId: string, newStatus: TicketStatus, resolution?: string) => void;
  onAddTicketMessage: (ticketId: string, message: string, isInternalNote: boolean) => void;
}

export const SupportTicketModal: React.FC<SupportTicketModalProps> = ({
  ticket,
  isOpen,
  onClose,
  onUpdateTicketStatus,
  onAddTicketMessage,
}) => {
  const [activeTab, setActiveTab] = useState<'conversation' | 'internal_notes' | 'resolution'>('conversation');
  const [replyText, setReplyText] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [resolutionNote, setResolutionNote] = useState(ticket?.resolution || '');
  const [statusDraft, setStatusDraft] = useState<TicketStatus>(ticket?.status || 'Open');

  React.useEffect(() => {
    if (ticket) {
      setStatusDraft(ticket.status);
      setResolutionNote(ticket.resolution || '');
    }
  }, [ticket]);

  if (!isOpen || !ticket) return null;

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim()) return;

    onAddTicketMessage(ticket.id, replyText.trim(), isInternalNote);
    setReplyText('');
  };

  const handleApplyResolution = () => {
    onUpdateTicketStatus(ticket.id, statusDraft, resolutionNote);
    onClose();
  };

  const getPriorityBadge = (priority: TicketPriority) => {
    switch (priority) {
      case 'Critical':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-900 text-zinc-100 border border-zinc-700">Critical</span>;
      case 'High':
        return <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-zinc-800 text-zinc-200 border border-zinc-700">High</span>;
      case 'Medium':
        return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-800">Medium</span>;
      case 'Low':
        return <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800/60 text-zinc-400 border border-zinc-800">Low</span>;
      default:
        return priority;
    }
  };

  const getStatusBadge = (status: TicketStatus) => {
    switch (status) {
      case 'Open':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700">Open</span>;
      case 'In Progress':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">In Progress</span>;
      case 'Waiting for Customer':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-800">Waiting for Customer</span>;
      case 'Resolved':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-100 border border-zinc-700">Resolved</span>;
      case 'Closed':
        return <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-900 text-zinc-400 border border-zinc-800">Closed</span>;
      default:
        return status;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden font-sans text-zinc-100">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-zinc-300">{ticket.id}</span>
                {getPriorityBadge(ticket.priority)}
                {getStatusBadge(ticket.status)}
              </div>
              <h2 className="text-sm font-bold text-zinc-100 mt-0.5">{ticket.subject}</h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Customer & Ticket Meta Bar */}
        <div className="px-5 py-3 bg-zinc-950/40 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-zinc-400">
            <span className="flex items-center gap-1.5 text-zinc-200">
              <User className="w-3.5 h-3.5 text-zinc-400" />
              {ticket.customerName}
            </span>
            <span className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-zinc-400" />
              {ticket.company}
            </span>
            <span className="font-mono">Cat: {ticket.category}</span>
          </div>

          <div className="flex items-center gap-3 text-zinc-400 font-mono text-[11px]">
            <span>Assigned: <strong className="text-zinc-200">{ticket.assignedTo}</strong></span>
            <span>Created: {ticket.createdDate}</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-800 px-5 gap-4 bg-zinc-950/20 text-xs">
          <button
            onClick={() => setActiveTab('conversation')}
            className={`py-3 font-medium border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'conversation'
                ? 'border-zinc-200 text-zinc-100 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Conversation Timeline ({ticket.messages.length})
          </button>

          <button
            onClick={() => setActiveTab('internal_notes')}
            className={`py-3 font-medium border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'internal_notes'
                ? 'border-zinc-200 text-zinc-100 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Internal Operator Notes ({ticket.internalNotes?.length || 0})
          </button>

          <button
            onClick={() => setActiveTab('resolution')}
            className={`py-3 font-medium border-b-2 flex items-center gap-1.5 transition ${
              activeTab === 'resolution'
                ? 'border-zinc-200 text-zinc-100 font-bold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Resolution & Status Workflow
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          
          {/* Conversation Timeline */}
          {activeTab === 'conversation' && (
            <div className="space-y-4">
              {ticket.messages.map(msg => (
                <div 
                  key={msg.id} 
                  className={`p-4 rounded-xl text-xs space-y-1.5 border ${
                    msg.isInternalNote
                      ? 'bg-zinc-950/80 border-zinc-700 text-zinc-200'
                      : msg.sender === 'Customer'
                      ? 'bg-zinc-950 border-zinc-800 text-zinc-200'
                      : 'bg-zinc-800/40 border-zinc-700 text-zinc-100'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2 font-semibold">
                      <span>{msg.senderName}</span>
                      <span className="font-mono text-[10px] text-zinc-400 px-1.5 py-0.2 rounded bg-zinc-800">
                        {msg.sender}
                      </span>
                      {msg.isInternalNote && (
                        <span className="font-mono text-[10px] text-zinc-300 px-1.5 py-0.2 rounded bg-zinc-700">
                          PRIVATE NOTE
                        </span>
                      )}
                    </div>
                    <span className="text-zinc-500 font-mono">{msg.timestamp}</span>
                  </div>
                  <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap">
                    {msg.message}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Internal Notes Tab */}
          {activeTab === 'internal_notes' && (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-400">
                Internal operator notes are only visible to Orion staff and auditors. Not shown to customers.
              </div>
              {ticket.internalNotes?.map((note, idx) => (
                <div key={idx} className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs space-y-1">
                  <div className="text-[10px] font-mono text-zinc-500">Internal Audit Note #{idx + 1}</div>
                  <p className="text-zinc-200 leading-relaxed">{note}</p>
                </div>
              ))}
            </div>
          )}

          {/* Resolution Tab */}
          {activeTab === 'resolution' && (
            <div className="space-y-4 text-xs">
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h3 className="font-bold text-zinc-200 text-sm">Update Ticket Lifecycle Status</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-zinc-400 mb-1">Ticket Status</label>
                    <select
                      value={statusDraft}
                      onChange={e => setStatusDraft(e.target.value as any)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                    >
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Waiting for Customer">Waiting for Customer</option>
                      <option value="Resolved">Resolved</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-zinc-400 mb-1">Assignee</label>
                    <input
                      type="text"
                      disabled
                      value={ticket.assignedTo}
                      className="w-full bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-400 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-zinc-400 mb-1">Official Resolution Summary</label>
                  <textarea
                    rows={3}
                    value={resolutionNote}
                    onChange={e => setResolutionNote(e.target.value)}
                    placeholder="Describe how the inquiry was resolved or what adjustments were made..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleApplyResolution}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition shadow"
                  >
                    Save Status & Resolution
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Message Input Footer for Conversation */}
        {activeTab === 'conversation' && (
          <form onSubmit={handleSendMessage} className="p-4 border-t border-zinc-800 bg-zinc-950/60 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-1.5 text-zinc-300 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={isInternalNote}
                  onChange={e => setIsInternalNote(e.target.checked)}
                  className="rounded accent-zinc-200"
                />
                <span>Post as Private Internal Note (Staff Only)</span>
              </label>

              <span className="text-[11px] text-zinc-500">Press Enter to dispatch</span>
            </div>

            <div className="flex gap-2">
              <textarea
                rows={2}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder={isInternalNote ? "Write an internal operator note..." : "Reply to customer directly..."}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-500 resize-none"
              />
              <button
                type="submit"
                className="px-4 text-xs font-bold rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 transition flex items-center gap-1.5 shrink-0"
              >
                <Send className="w-3.5 h-3.5" /> Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
