'use client';

import React, { useState } from 'react';
import { X, Bookmark, Bell, Mail, Check } from 'lucide-react';

interface SaveSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (searchName: string, frequency: string, emailAlert: boolean) => void;
  currentFilterSummary: string;
}

export function SaveSearchModal({
  isOpen,
  onClose,
  onSave,
  currentFilterSummary,
}: SaveSearchModalProps) {
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [emailAlert, setEmailAlert] = useState(true);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), frequency, emailAlert);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between bg-zinc-50/50 dark:bg-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center shadow-xs">
              <Bookmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Save Search & Create Alert
              </h3>
              <p className="text-xs text-zinc-500">
                Get notified when new matching businesses register
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block mb-1.5">
              Saved Search Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. CA Tech Startups No Website"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-zinc-400 dark:focus:ring-zinc-600"
            />
          </div>

          <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-zinc-900 dark:text-zinc-200 block mb-1">Active Criteria:</span>
            <span>{currentFilterSummary || 'All Leads'}</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 block mb-1.5">
              Notification Frequency
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'instant', label: 'Instant' },
                { id: 'daily', label: 'Daily Digest' },
                { id: 'weekly', label: 'Weekly Summary' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setFrequency(item.id)}
                  className={`py-2 px-1 text-center rounded-lg border font-medium transition-all ${
                    frequency === item.id
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2.5 pt-1 cursor-pointer">
            <input
              type="checkbox"
              checked={emailAlert}
              onChange={(e) => setEmailAlert(e.target.checked)}
              className="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-0 w-4 h-4"
            />
            <span className="text-zinc-700 dark:text-zinc-300 font-medium">Send email notifications to my primary inbox</span>
          </label>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-5 py-2 text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50 rounded-lg shadow-xs transition-all"
            >
              Save Search
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
