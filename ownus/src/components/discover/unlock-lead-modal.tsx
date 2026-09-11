'use client';

import React from 'react';
import { X, Lock, Sparkles, ShieldCheck, Phone, Mail, CheckCircle2, Zap, Check } from 'lucide-react';
import { Business } from '@/lib/types';

interface UnlockLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  business?: Business | null;
  bulkCount?: number;
  availableCredits?: number;
}

export function UnlockLeadModal({
  isOpen,
  onClose,
  onConfirm,
  business,
  bulkCount = 1,
  availableCredits = 250,
}: UnlockLeadModalProps) {
  if (!isOpen) return null;

  const creditsRequired = business ? (business.creditsRequired || 1) : bulkCount;
  const remainingCredits = availableCredits - creditsRequired;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between bg-zinc-50/50 dark:bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-xs">
              <Zap className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {bulkCount > 1 ? `Unlock ${bulkCount} Leads` : 'Unlock Direct Contacts'}
              </h3>
              <p className="text-xs text-zinc-500">
                {business ? business.name : `${bulkCount} selected businesses`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 text-xs">
          <div className="space-y-2 text-zinc-600 dark:text-zinc-400">
            <p>Unlocking will reveal verified intelligence for your outreach:</p>
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-medium">
                <Check className="w-4 h-4 text-zinc-900 dark:text-white shrink-0" />
                <span>Direct phone number & WhatsApp direct link</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-medium">
                <Check className="w-4 h-4 text-zinc-900 dark:text-white shrink-0" />
                <span>Verified business decision maker email address</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-800 dark:text-zinc-200 font-medium">
                <Check className="w-4 h-4 text-zinc-900 dark:text-white shrink-0" />
                <span>Full corporate registration details & CIN/GST status</span>
              </div>
            </div>
          </div>

          {/* Credit Math Box */}
          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
            <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
              <span>Credits Required:</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{creditsRequired} Credit{creditsRequired > 1 ? 's' : ''}</span>
            </div>
            <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
              <span>Your Credit Balance:</span>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{availableCredits}</span>
            </div>
            <div className="border-t border-zinc-200 dark:border-zinc-800 pt-2 flex justify-between items-center font-bold text-zinc-900 dark:text-zinc-100">
              <span>Remaining Balance:</span>
              <span className="font-mono">
                {remainingCredits}
              </span>
            </div>
          </div>

          {remainingCredits < 0 && (
            <p className="text-zinc-900 dark:text-zinc-100 font-medium underline">
              Insufficient credits. Please top up your account.
            </p>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={remainingCredits < 0}
            className="px-5 py-2 text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 rounded-lg shadow-xs transition-all cursor-pointer"
          >
            Confirm & Unlock ({creditsRequired} Credits)
          </button>
        </div>

      </div>
    </div>
  );
}
