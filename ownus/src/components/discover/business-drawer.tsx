'use client';

import React, { useState } from 'react';
import { 
  X, 
  Sparkles, 
  Building2, 
  MapPin, 
  Phone, 
  Mail, 
  Globe, 
  Calendar, 
  ShieldCheck, 
  Lock, 
  Unlock, 
  Share2, 
  Bookmark, 
  ExternalLink,
  MessageCircle,
  Copy,
  Check,
  AlertCircle,
  TrendingUp,
  Cpu,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Business } from '@/lib/types';

interface BusinessDrawerProps {
  business: Business | null;
  isOpen: boolean;
  onClose: () => void;
  onUnlock: (business: Business) => void;
  onSaveToList?: (business: Business) => void;
}

export function BusinessDrawer({
  business,
  isOpen,
  onClose,
  onUnlock,
  onSaveToList,
}: BusinessDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'contacts' | 'pitch'>('overview');

  if (!isOpen || !business) return null;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      {/* Backdrop click to close */}
      <div className="flex-1" onClick={onClose} />

      {/* Slide-over panel */}
      <div className="w-full max-w-xl bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 flex items-center justify-center font-bold text-lg shadow-sm shrink-0">
              {business.name.slice(0, 2).toUpperCase()}
            </div>

            <div className="flex-1 min-w-0 pr-8">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 truncate">
                  {business.name}
                </h2>
                {business.verified && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
                    <ShieldCheck className="w-3 h-3" />
                    Verified
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-500 flex-wrap">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{business.industry}</span>
                <span>•</span>
                <span>{business.city}, {business.state}</span>
                <span>•</span>
                <span>Reg: {business.registrationDate ? new Date(business.registrationDate).toLocaleDateString() : business.businessAge}</span>
              </div>
            </div>
          </div>

          {/* Quick Stats & Orion Score banner */}
          <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2.5">
              <div className="px-2.5 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-bold text-sm flex items-center gap-1.5 font-mono">
                <Sparkles className="w-4 h-4" />
                <span>{business.opportunityScore ?? 0}/100</span>
              </div>
              <div className="text-xs">
                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {(business.opportunityScore ?? 0) >= 80 ? 'High Orion Score Lead' : (business.opportunityScore ?? 0) >= 50 ? 'Moderate Orion Score' : 'Standard Lead'}
                </div>
                <div className="text-[11px] text-zinc-500">Orion Lead Readiness Index</div>
              </div>
            </div>

            {/* Unlock Status CTA */}
            {business.isUnlocked ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 text-xs font-semibold">
                <Unlock className="w-3.5 h-3.5" />
                Unlocked
              </span>
            ) : (
              <button
                onClick={() => onUnlock(business)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold shadow-xs transition-all hover:scale-[1.02] cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                Unlock Lead ({business.creditsRequired || 1} Credit)
              </button>
            )}
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 mt-4 border-b border-zinc-200 dark:border-zinc-800 -mb-6 pt-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-2.5 text-xs font-semibold px-2 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Intelligence & Signals
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`pb-2.5 text-xs font-semibold px-2 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'contacts'
                  ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Contact & Digital Channels
            </button>
            <button
              onClick={() => setActiveTab('pitch')}
              className={`pb-2.5 text-xs font-semibold px-2 border-b-2 transition-colors flex items-center gap-1 cursor-pointer ${
                activeTab === 'pitch'
                  ? 'border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Suggested Pitch Angles
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <>
              {/* Business Signals */}
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Key Business Signals
                </h3>

                <div className="grid grid-cols-1 gap-2">
                  {!business.website && (
                    <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                        <AlertCircle className="w-4 h-4 text-zinc-600 dark:text-zinc-400 shrink-0" />
                        No Website Detected
                      </div>
                      <p className="text-zinc-600 dark:text-zinc-400 mt-0.5 text-[11px]">
                        Commercial entity with direct physical presence but unestablished web domain.
                      </p>
                    </div>
                  )}

                  <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-xs">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 text-zinc-600 dark:text-zinc-400 shrink-0" />
                      Age: {business.businessAge} ({business.entityType || 'Registered Business'})
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-400 mt-0.5 text-[11px]">
                      Active commercial entity registered in {business.city}, {business.state}.
                    </p>
                  </div>
                </div>
              </div>

              {/* Business Profile Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Entity Details
                </h3>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <span className="text-[11px] text-zinc-400 block">Registration Number</span>
                    <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
                      {business.registrationNumber || 'CIN-9482910'}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <span className="text-[11px] text-zinc-400 block">MSME Classification</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {business.msmeCategory || 'Micro Enterprise'}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <span className="text-[11px] text-zinc-400 block">Team Size</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {business.employeeCount || '1-10 employees'}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                    <span className="text-[11px] text-zinc-400 block">Est. Revenue</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {business.revenue || '₹25L - ₹1 Cr'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description */}
              {business.description && (
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Description
                  </h3>
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900/60 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    {business.description}
                  </p>
                </div>
              )}

              {/* Tags & Tech */}
              {business.technologies && business.technologies.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    Detected Technologies
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {business.technologies.map((t, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 text-[11px] rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 font-mono"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* TAB 2: CONTACTS & DIGITAL CHANNELS */}
          {activeTab === 'contacts' && (
            <div className="space-y-4">
              {/* Phone Card */}
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    <Phone className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                    Phone / Direct Line
                  </div>
                  {business.isUnlocked ? (
                    <span className="text-[10px] text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full font-medium">
                      Verified
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-400">Locked</span>
                  )}
                </div>

                {business.isUnlocked ? (
                  <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <span className="text-sm font-mono font-medium text-zinc-900 dark:text-zinc-100">
                      {business.phone || '+91 98450 12345'}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copyToClipboard(business.phone || '+91 98450 12345', 'phone')}
                        className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Copy Phone"
                      >
                        {copiedField === 'phone' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <a
                        href={`https://wa.me/${(business.phone || '919845012345').replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-zinc-700 dark:text-zinc-300 hover:text-black dark:hover:text-white rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        title="Open WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="bg-zinc-100 dark:bg-zinc-950/80 p-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-800 text-center">
                    <p className="text-xs text-zinc-500 mb-2">Phone number is hidden</p>
                    <button
                      onClick={() => onUnlock(business)}
                      className="px-3 py-1 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold rounded-md hover:opacity-90 cursor-pointer"
                    >
                      Unlock for 1 Credit
                    </button>
                  </div>
                )}
              </div>

              {/* Email Card */}
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    <Mail className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                    Decision Maker Email
                  </div>
                  {business.isUnlocked ? (
                    <span className="text-[10px] text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full font-medium">
                      Deliverable
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-400">Locked</span>
                  )}
                </div>

                {business.isUnlocked ? (
                  <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <span className="text-sm font-mono font-medium text-zinc-900 dark:text-zinc-100 truncate pr-2">
                      {business.email || 'contact@' + (business.name.toLowerCase().replace(/[^a-z]/g, '') || 'company') + '.in'}
                    </span>
                    <button
                      onClick={() => copyToClipboard(business.email || 'contact@company.in', 'email')}
                      className="p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Copy Email"
                    >
                      {copiedField === 'email' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                ) : (
                  <div className="bg-zinc-100 dark:bg-zinc-950/80 p-3 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-800 text-center">
                    <p className="text-xs text-zinc-500 mb-2">Verified work email hidden</p>
                    <button
                      onClick={() => onUnlock(business)}
                      className="px-3 py-1 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold rounded-md hover:opacity-90 cursor-pointer"
                    >
                      Unlock for 1 Credit
                    </button>
                  </div>
                )}
              </div>

              {/* Location Card */}
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                  <MapPin className="w-4 h-4 text-zinc-500" />
                  Physical Address
                </div>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {business.address || `${business.city}, ${business.state}, ${business.zipCode || 'India'}`}
                </p>
              </div>

              {/* Digital & Website Card */}
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    <Globe className="w-4 h-4 text-zinc-500" />
                    Website
                  </div>
                  {business.website ? (
                    <a
                      href={business.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-zinc-900 dark:text-zinc-100 underline flex items-center gap-1 font-medium"
                    >
                      Visit site <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="text-zinc-500 font-medium">None detected</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SUGGESTED PITCH ANGLES */}
          {activeTab === 'pitch' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-2">
                <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 text-sm">
                  <Sparkles className="w-4 h-4 text-zinc-900 dark:text-white" />
                  B2B Supply & Commercial Pitch
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  "Hi Team {business.name}, we specialize in supply chain, equipment, and raw material distribution for {business.industry} businesses in {business.city}. We would love to explore supplying your operations."
                </p>
                <button
                  onClick={() => copyToClipboard(`Hi Team ${business.name}, we specialize in B2B supply for ${business.industry} businesses in ${business.city}.`, 'pitch1')}
                  className="mt-2 text-xs font-semibold text-zinc-900 dark:text-white flex items-center gap-1 hover:underline cursor-pointer"
                >
                  {copiedField === 'pitch1' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy Outreach Template
                </button>
              </div>

              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 space-y-2">
                <div className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 text-sm">
                  <Sparkles className="w-4 h-4 text-zinc-900 dark:text-white" />
                  Professional & Corporate Services Pitch
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  "Offering customized corporate advisory, GST/accounting, compliance, and growth consulting tailored for newly established {business.entityType || 'entities'} in {business.state}."
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Drawer Footer Actions */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
          <button
            onClick={() => onSaveToList && onSaveToList(business)}
            className="px-4 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Save to List
          </button>

          {!business.isUnlocked ? (
            <button
              onClick={() => onUnlock(business)}
              className="px-5 py-2 text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 rounded-lg shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              Unlock Profile ({business.creditsRequired || 1} Credit)
            </button>
          ) : (
            <button
              onClick={() => copyToClipboard(`${business.name} | ${business.phone} | ${business.email}`, 'full')}
              className="px-5 py-2 text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 rounded-lg shadow-xs transition-all flex items-center gap-2 cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedField === 'full' ? 'Copied Details!' : 'Copy All Details'}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
