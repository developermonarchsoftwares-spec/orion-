'use client';

import React, { useState } from 'react';
import { AdminBusinessRecord, BusinessStatus } from '@/types/admin';
import {
  X,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  FileText,
  ShieldCheck,
  Send,
  Trash2,
  Archive,
  ArrowRight,
  ExternalLink,
  Check,
  MessageSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BusinessDetailsModalProps {
  business: AdminBusinessRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateStatus: (id: string, newStatus: BusinessStatus) => void;
  onSaveNotes?: (id: string, note: string) => void;
}

export function BusinessDetailsModal({
  business,
  isOpen,
  onClose,
  onUpdateStatus,
  onSaveNotes
}: BusinessDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'contact' | 'location' | 'digital' | 'validation' | 'audit' | 'notes'>('general');
  const [newNote, setNewNote] = useState('');

  if (!isOpen || !business) return null;

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    if (onSaveNotes) {
      onSaveNotes(business.id, newNote.trim());
    }
    setNewNote('');
  };

  const getStatusBadge = (status: BusinessStatus) => {
    switch (status) {
      case 'published':
        return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 uppercase">Published</span>;
      case 'approved':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 uppercase">Approved</span>;
      case 'validated':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 uppercase">Validated</span>;
      case 'draft':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400 uppercase">Draft</span>;
      case 'rejected':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200 uppercase line-through">Rejected</span>;
      case 'archived':
        return <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600 uppercase">Archived</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in-50">
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4 bg-zinc-50/50 dark:bg-zinc-900/30">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-xs font-semibold text-zinc-400">{business.id}</span>
              {getStatusBadge(business.status)}
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                Quality: {business.dataQualityScore}%
              </span>
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                Opp Score: {business.opportunityScore}
              </span>
            </div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 truncate">{business.name}</h2>
            <p className="text-xs text-zinc-500 truncate">{business.industry} • {business.category} • {business.city}, {business.state}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Workflow Action Bar */}
        <div className="px-5 py-2.5 bg-zinc-100/60 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-1.5 font-medium text-zinc-500">
            <span>Publish Lifecycle:</span>
            <span className="font-semibold text-zinc-900 dark:text-zinc-100 capitalize">{business.status}</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {business.status !== 'published' && (
              <button
                onClick={() => onUpdateStatus(business.id, 'published')}
                className="px-3 py-1.5 rounded-md font-semibold bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Publish to Discover</span>
              </button>
            )}

            {business.status === 'draft' && (
              <button
                onClick={() => onUpdateStatus(business.id, 'validated')}
                className="px-3 py-1.5 rounded-md font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Validate Schema
              </button>
            )}

            {business.status === 'validated' && (
              <button
                onClick={() => onUpdateStatus(business.id, 'approved')}
                className="px-3 py-1.5 rounded-md font-semibold bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Approve Record
              </button>
            )}

            {business.status !== 'rejected' && (
              <button
                onClick={() => onUpdateStatus(business.id, 'rejected')}
                className="px-3 py-1.5 rounded-md font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Reject
              </button>
            )}

            {business.status !== 'draft' && (
              <button
                onClick={() => onUpdateStatus(business.id, 'draft')}
                className="px-3 py-1.5 rounded-md font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Move to Draft
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800 px-5 gap-4 overflow-x-auto text-xs font-semibold">
          {[
            { id: 'general', label: 'General Info' },
            { id: 'contact', label: 'Contact Details' },
            { id: 'location', label: 'Location & GIS' },
            { id: 'digital', label: 'Digital Presence' },
            { id: 'validation', label: `Validation (${business.validationErrors.length})` },
            { id: 'audit', label: 'Audit Log' },
            { id: 'notes', label: `Notes (${business.internalNotes?.length || 0})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'py-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer',
                activeTab === tab.id
                  ? 'border-zinc-900 text-zinc-900 dark:border-white dark:text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
          
          {/* 1. GENERAL INFORMATION */}
          {activeTab === 'general' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-zinc-400 font-medium">Business / Trade Name</label>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">{business.name}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-zinc-400 font-medium">Primary Industry</label>
                  <p className="font-semibold text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">{business.industry}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-zinc-400 font-medium">Sub Industry / Vertical</label>
                  <p className="text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">{business.subIndustry || '—'}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-zinc-400 font-medium">Business Category</label>
                  <p className="text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">{business.category}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-zinc-400 font-medium">Legal Constitution / Business Type</label>
                  <p className="text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">{business.businessType || 'Unspecified'}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-zinc-400 font-medium">MSME Classification</label>
                  <p className="text-zinc-800 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-900 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">{business.msmeCategory || 'Not Registered'}</p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-zinc-400 font-medium">Business Summary & Description</label>
                <p className="text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 leading-relaxed">
                  {business.description || 'No detailed description provided.'}
                </p>
              </div>

              {business.tags && business.tags.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-zinc-400 font-medium block">Metadata Tags</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {business.tags.map(t => (
                      <span key={t} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 font-medium text-[11px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. CONTACT DETAILS */}
          {activeTab === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Primary Phone</span>
                  <span className="text-[10px] text-zinc-500">Telecom Validated</span>
                </div>
                <p className="text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100">{business.phone || '—'}</p>
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="flex items-center gap-1.5"><MessageSquare className="w-3.5 h-3.5" /> WhatsApp Business</span>
                  <span className="text-[10px] text-zinc-500">WhatsApp API</span>
                </div>
                <p className="text-sm font-semibold font-mono text-zinc-900 dark:text-zinc-100">{business.whatsapp || 'Not Available'}</p>
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Official Email</span>
                  <span className="text-[10px] text-zinc-500">MX Server Check</span>
                </div>
                <p className="text-sm font-mono text-zinc-900 dark:text-zinc-100">{business.email || '—'}</p>
              </div>

              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Official Website</span>
                  <span className="text-[10px] text-zinc-500">{business.hasWebsite ? 'Active Domain' : 'Missing Website'}</span>
                </div>
                {business.website ? (
                  <a href={business.website} target="_blank" rel="noreferrer" className="text-sm font-mono text-zinc-900 dark:text-zinc-100 hover:underline flex items-center gap-1">
                    <span>{business.website}</span>
                    <ExternalLink className="w-3 h-3 text-zinc-400" />
                  </a>
                ) : (
                  <p className="text-sm text-zinc-400 italic">No website discovered (High digital upgrade lead)</p>
                )}
              </div>
            </div>
          )}

          {/* 3. LOCATION & GIS */}
          {activeTab === 'location' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                <span className="text-zinc-400 font-medium">Physical Premises Address</span>
                <p className="text-sm text-zinc-900 dark:text-zinc-100 font-medium">{business.address}</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold block">State</span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{business.state}</span>
                </div>
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold block">District</span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{business.district}</span>
                </div>
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold block">City / Hub</span>
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{business.city}</span>
                </div>
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-[10px] text-zinc-400 uppercase font-semibold block">Pincode</span>
                  <span className="text-xs font-mono font-bold text-zinc-900 dark:text-zinc-100">{business.pincode}</span>
                </div>
              </div>

              {business.googleMapsLink && (
                <div className="flex items-center justify-between p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5"><MapPin className="w-4 h-4" /> Google Maps Geolocation</span>
                  <a href={business.googleMapsLink} target="_blank" rel="noreferrer" className="text-xs font-medium underline flex items-center gap-1 hover:text-zinc-900 dark:hover:text-white">
                    Open Map Coordinates <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          )}

          {/* 4. DIGITAL PRESENCE */}
          {activeTab === 'digital' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-zinc-400 block mb-1 font-medium">Domain Status</span>
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{business.hasWebsite ? 'Registered & Responsive' : 'No Domain Detected'}</span>
                </div>
                <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-zinc-400 block mb-1 font-medium">Opportunity Score</span>
                  <span className="text-sm font-bold font-mono text-zinc-900 dark:text-zinc-100">{business.opportunityScore} / 100</span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-2">
                <h4 className="font-semibold text-zinc-900 dark:text-zinc-100">AI Opportunity Evaluation</h4>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  {!business.hasWebsite 
                    ? 'High value web design & ERP opportunity. This commercial establishment has verified physical operations, valid phone records, and active GST registration without a dedicated digital landing page.'
                    : 'Established digital footprint. Prime target for SEO, paid ad automation, cloud ERP integration, and branding services.'}
                </p>
              </div>
            </div>
          )}

          {/* 5. VALIDATION RESULTS */}
          {activeTab === 'validation' && (
            <div className="space-y-4">
              {business.validationErrors.length === 0 ? (
                <div className="p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-zinc-900 dark:text-white mx-auto" />
                  <h4 className="font-bold text-zinc-900 dark:text-zinc-100">Zero Schema Errors</h4>
                  <p className="text-xs text-zinc-500">All required fields (Name, Phone, State, District, City, Pincode) pass Indian schema compliance checks.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <h4 className="font-bold text-zinc-900 dark:text-zinc-100">Flags Requiring Manual Review ({business.validationErrors.length})</h4>
                  {business.validationErrors.map((err, i) => (
                    <div key={i} className="p-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-zinc-800 dark:text-zinc-200 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{err}</p>
                        <p className="text-[11px] text-zinc-500">Operator review required prior to approving record.</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {business.missingFields.length > 0 && (
                <div className="p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100 block">Missing Optional Attributes:</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {business.missingFields.map(f => (
                      <span key={f} className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. AUDIT LOG */}
          {activeTab === 'audit' && (
            <div className="space-y-3">
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 space-y-1">
                <span className="text-zinc-400 block font-medium">Ingestion Batch Source</span>
                <p className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">{business.importedBy || 'Direct Platform Ingestion'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-zinc-400 block font-medium">Ingestion Timestamp</span>
                  <p className="font-mono text-zinc-800 dark:text-zinc-200">{business.createdAt}</p>
                </div>
                <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                  <span className="text-zinc-400 block font-medium">Last Modified Timestamp</span>
                  <p className="font-mono text-zinc-800 dark:text-zinc-200">{business.updatedAt}</p>
                </div>
              </div>
            </div>
          )}

          {/* 7. INTERNAL NOTES */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <form onSubmit={handleAddNote} className="space-y-2">
                <label className="font-medium text-zinc-700 dark:text-zinc-300 block">Add Operator Note</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Phone confirmed with sales manager on Sep 8..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="flex-1 px-3 py-2 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg focus:outline-hidden"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    Post Note
                  </button>
                </div>
              </form>

              <div className="space-y-2">
                {business.internalNotes && business.internalNotes.length > 0 ? (
                  business.internalNotes.map((note, index) => (
                    <div key={index} className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-start gap-2.5">
                      <FileText className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-zinc-800 dark:text-zinc-200">{note}</p>
                        <p className="text-[10px] text-zinc-400 mt-1">Admin Operator • Internal Record</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-400 italic text-center py-6">No operator notes recorded yet.</p>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 flex justify-between items-center text-xs">
          <span className="text-zinc-400 font-mono">Record ID: {business.id}</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold transition-colors cursor-pointer"
          >
            Close Details
          </button>
        </div>

      </div>
    </div>
  );
}
