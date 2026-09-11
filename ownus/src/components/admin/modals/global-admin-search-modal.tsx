'use client';

import React, { useState, useEffect, useRef } from 'react';
import { 
  AdminBusinessRecord, 
  CustomerUser, 
  TransactionRecord, 
  SupportTicket, 
  ActivityLogEntry 
} from '@/types/admin';
import { 
  Search, 
  X, 
  Building2, 
  Users, 
  CreditCard, 
  LifeBuoy, 
  ScrollText, 
  ArrowRight 
} from 'lucide-react';

interface GlobalAdminSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  businesses: AdminBusinessRecord[];
  users?: CustomerUser[];
  transactions?: TransactionRecord[];
  tickets?: SupportTicket[];
  logs?: ActivityLogEntry[];
  onSelectBusiness?: (business: AdminBusinessRecord) => void;
  onSelectUser?: (user: CustomerUser) => void;
  onSelectTicket?: (ticket: SupportTicket) => void;
}

export function GlobalAdminSearchModal({
  isOpen,
  onClose,
  businesses,
  users = [],
  transactions = [],
  tickets = [],
  logs = [],
  onSelectBusiness,
  onSelectUser,
  onSelectTicket
}: GlobalAdminSearchModalProps) {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'businesses' | 'users' | 'transactions' | 'tickets' | 'logs'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setFilterType('all');
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();

  // Matched entities
  const matchingBusinesses = (filterType === 'all' || filterType === 'businesses') ? businesses.filter(b => {
    if (!q) return true;
    return (
      b.name.toLowerCase().includes(q) ||
      b.phone.toLowerCase().includes(q) ||
      b.email.toLowerCase().includes(q) ||
      b.city.toLowerCase().includes(q) ||
      b.state.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
    );
  }).slice(0, 4) : [];

  const matchingUsers = (filterType === 'all' || filterType === 'users') ? users.filter(u => {
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.company.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.id.toLowerCase().includes(q)
    );
  }).slice(0, 3) : [];

  const matchingTransactions = (filterType === 'all' || filterType === 'transactions') ? transactions.filter(t => {
    if (!q) return true;
    return (
      t.id.toLowerCase().includes(q) ||
      t.customerName.toLowerCase().includes(q) ||
      t.receiptNumber.toLowerCase().includes(q)
    );
  }).slice(0, 3) : [];

  const matchingTickets = (filterType === 'all' || filterType === 'tickets') ? tickets.filter(t => {
    if (!q) return true;
    return (
      t.id.toLowerCase().includes(q) ||
      t.subject.toLowerCase().includes(q) ||
      t.customerName.toLowerCase().includes(q)
    );
  }).slice(0, 3) : [];

  const matchingLogs = (filterType === 'all' || filterType === 'logs') ? logs.filter(l => {
    if (!q) return true;
    return (
      l.user.toLowerCase().includes(q) ||
      l.entityName.toLowerCase().includes(q) ||
      l.details.toLowerCase().includes(q)
    );
  }).slice(0, 3) : [];

  const totalResults = matchingBusinesses.length + matchingUsers.length + matchingTransactions.length + matchingTickets.length + matchingLogs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in-50">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden text-xs">
        
        {/* Search Input Bar */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3 relative">
          <Search className="w-5 h-5 text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search across businesses, users, transactions, tickets, and audit logs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden"
          />
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Categories Pill Bar */}
        <div className="px-4 py-2 bg-zinc-50 dark:bg-zinc-900/40 border-b border-zinc-200 dark:border-zinc-800 flex gap-2 overflow-x-auto text-[11px]">
          {[
            { id: 'all', label: 'All Results' },
            { id: 'businesses', label: 'Businesses' },
            { id: 'users', label: 'Users' },
            { id: 'transactions', label: 'Transactions' },
            { id: 'tickets', label: 'Support Tickets' },
            { id: 'logs', label: 'Activity Logs' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id as any)}
              className={`px-2.5 py-1 rounded-md font-semibold transition ${
                filterType === f.id
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-950'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60 p-2 space-y-2">
          {totalResults > 0 ? (
            <>
              {/* Business Results */}
              {matchingBusinesses.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1.5">
                    <Building2 className="w-3 h-3" /> Businesses ({matchingBusinesses.length})
                  </div>
                  {matchingBusinesses.map(b => (
                    <button
                      key={b.id}
                      onClick={() => {
                        if (onSelectBusiness) onSelectBusiness(b);
                        onClose();
                      }}
                      className="w-full text-left p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg flex items-center justify-between gap-3 group transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs truncate">{b.name}</div>
                        <div className="text-zinc-500 text-[11px] truncate">{b.industry} • {b.city}, {b.state} • {b.phone}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* User Results */}
              {matchingUsers.length > 0 && (
                <div className="space-y-1 pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> Customers & Users ({matchingUsers.length})
                  </div>
                  {matchingUsers.map(u => (
                    <button
                      key={u.id}
                      onClick={() => {
                        if (onSelectUser) onSelectUser(u);
                        onClose();
                      }}
                      className="w-full text-left p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg flex items-center justify-between gap-3 group transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs truncate">{u.name} ({u.company})</div>
                        <div className="text-zinc-500 text-[11px] truncate">{u.email} • {u.plan} Plan • {u.credits} Credits</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Ticket Results */}
              {matchingTickets.length > 0 && (
                <div className="space-y-1 pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1.5">
                    <LifeBuoy className="w-3 h-3" /> Support Tickets ({matchingTickets.length})
                  </div>
                  {matchingTickets.map(t => (
                    <button
                      key={t.id}
                      onClick={() => {
                        if (onSelectTicket) onSelectTicket(t);
                        onClose();
                      }}
                      className="w-full text-left p-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg flex items-center justify-between gap-3 group transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs truncate">{t.id}: {t.subject}</div>
                        <div className="text-zinc-500 text-[11px] truncate">{t.customerName} • {t.priority} Priority • {t.status}</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white shrink-0" />
                    </button>
                  ))}
                </div>
              )}

              {/* Transactions */}
              {matchingTransactions.length > 0 && (
                <div className="space-y-1 pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1.5">
                    <CreditCard className="w-3 h-3" /> Ledger Transactions ({matchingTransactions.length})
                  </div>
                  {matchingTransactions.map(tx => (
                    <div
                      key={tx.id}
                      className="p-2.5 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs truncate">{tx.id} • {tx.customerName}</div>
                        <div className="text-zinc-500 text-[11px] truncate">₹{tx.amount.toLocaleString()} • {tx.creditsPurchased} Credits • {tx.paymentStatus}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Activity Logs */}
              {matchingLogs.length > 0 && (
                <div className="space-y-1 pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1.5">
                    <ScrollText className="w-3 h-3" /> Audit Logs ({matchingLogs.length})
                  </div>
                  {matchingLogs.map(l => (
                    <div
                      key={l.id}
                      className="p-2.5 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-zinc-900 dark:text-zinc-100 text-xs truncate">{l.action}: {l.entityName}</div>
                        <div className="text-zinc-500 text-[11px] truncate">{l.user} • {l.details}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-zinc-500">
              <p className="font-medium">No results matching &quot;{query}&quot;</p>
              <p className="text-[11px] text-zinc-400 mt-1">Try searching across names, ticket IDs, transaction receipts or emails.</p>
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex justify-between items-center text-[10px] text-zinc-400 font-mono">
          <span>Global Search Index</span>
          <span>Press ESC to exit</span>
        </div>

      </div>
    </div>
  );
}
