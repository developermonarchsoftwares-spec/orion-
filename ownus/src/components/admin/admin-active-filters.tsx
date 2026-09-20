'use client';

import React from 'react';
import { X, RotateCcw } from 'lucide-react';
import { DiscoverFilterState, initialFilterState } from '@/components/discover/discover-filters';

interface AdminActiveFiltersProps {
  filters: DiscoverFilterState;
  onFiltersChange: (filters: DiscoverFilterState) => void;
  activeChips?: string[];
  onToggleChip?: (chipId: string) => void;
  onClearAll: () => void;
  className?: string;
}

export function AdminActiveFilters({
  filters,
  onFiltersChange,
  activeChips = [],
  onToggleChip,
  onClearAll,
  className = '',
}: AdminActiveFiltersProps) {
  // Collect all active badges
  const badges: { id: string; label: string; onRemove: () => void }[] = [];

  // State
  if (filters.state) {
    badges.push({
      id: `state-${filters.state}`,
      label: `State: ${filters.state}`,
      onRemove: () =>
        onFiltersChange({ ...filters, state: '', districts: [], cities: [], states: [] }),
    });
  }

  // Districts
  if (filters.districts && filters.districts.length > 0) {
    filters.districts.forEach((dist) => {
      badges.push({
        id: `district-${dist}`,
        label: `District: ${dist}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            districts: filters.districts.filter((d) => d !== dist),
          }),
      });
    });
  }

  // Cities
  if (filters.cities && filters.cities.length > 0) {
    filters.cities.forEach((city) => {
      badges.push({
        id: `city-${city}`,
        label: `City: ${city}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            cities: filters.cities.filter((c) => c !== city),
          }),
      });
    });
  }

  // Pincode
  if (filters.pincode) {
    badges.push({
      id: `pin-${filters.pincode}`,
      label: `PIN: ${filters.pincode}`,
      onRemove: () => onFiltersChange({ ...filters, pincode: '' }),
    });
  }

  // Industries
  if (filters.industries && filters.industries.length > 0) {
    filters.industries.forEach((ind) => {
      badges.push({
        id: `ind-${ind}`,
        label: `Industry: ${ind}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            industries: filters.industries.filter((i) => i !== ind),
          }),
      });
    });
  }

  // Sub-Industries
  if (filters.subIndustries && filters.subIndustries.length > 0) {
    filters.subIndustries.forEach((sub) => {
      badges.push({
        id: `sub-${sub}`,
        label: `Sub-Industry: ${sub}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            subIndustries: filters.subIndustries.filter((s) => s !== sub),
          }),
      });
    });
  }

  // Categories
  if (filters.businessCategories && filters.businessCategories.length > 0) {
    filters.businessCategories.forEach((cat) => {
      badges.push({
        id: `cat-${cat}`,
        label: `Category: ${cat}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            businessCategories: filters.businessCategories.filter((c) => c !== cat),
          }),
      });
    });
  }

  // Business Types
  if (filters.businessTypes && filters.businessTypes.length > 0) {
    filters.businessTypes.forEach((type) => {
      badges.push({
        id: `type-${type}`,
        label: `Type: ${type}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            businessTypes: filters.businessTypes.filter((t) => t !== type),
          }),
      });
    });
  }

  // MSME Categories
  if (filters.msmeCategories && filters.msmeCategories.length > 0) {
    filters.msmeCategories.forEach((msme) => {
      badges.push({
        id: `msme-${msme}`,
        label: `MSME: ${msme}`,
        onRemove: () =>
          onFiltersChange({
            ...filters,
            msmeCategories: filters.msmeCategories.filter((m) => m !== msme),
          }),
      });
    });
  }

  // Age Preset
  if (filters.agePreset && filters.agePreset !== 'all') {
    const labels: Record<string, string> = {
      today: 'Added Today',
      yesterday: 'Added Yesterday',
      '7d': 'Last 7 Days',
      '30d': 'Last 30 Days',
      '90d': 'Last 90 Days',
      custom: 'Custom Date Range',
    };
    badges.push({
      id: `age-${filters.agePreset}`,
      label: `Age: ${labels[filters.agePreset] || filters.agePreset}`,
      onRemove: () =>
        onFiltersChange({
          ...filters,
          agePreset: 'all',
          customDateStart: '',
          customDateEnd: '',
        }),
    });
  }

  // Max Months
  if (filters.ageMaxMonths < 36) {
    badges.push({
      id: `age-months-${filters.ageMaxMonths}`,
      label: `Age: ≤ ${filters.ageMaxMonths} mo`,
      onRemove: () => onFiltersChange({ ...filters, ageMaxMonths: 36 }),
    });
  }

  // Contact Availability
  if (filters.contactAvailability.hasWebsite) {
    badges.push({
      id: 'contact-hasWebsite',
      label: 'Has Website',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          contactAvailability: { ...filters.contactAvailability, hasWebsite: false },
        }),
    });
  }
  if (filters.contactAvailability.noWebsite) {
    badges.push({
      id: 'contact-noWebsite',
      label: 'No Website (Opportunity)',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          contactAvailability: { ...filters.contactAvailability, noWebsite: false },
        }),
    });
  }
  if (filters.contactAvailability.hasEmail) {
    badges.push({
      id: 'contact-hasEmail',
      label: 'Has Email',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          contactAvailability: { ...filters.contactAvailability, hasEmail: false },
        }),
    });
  }
  if (filters.contactAvailability.hasPhone) {
    badges.push({
      id: 'contact-hasPhone',
      label: 'Has Phone',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          contactAvailability: { ...filters.contactAvailability, hasPhone: false },
        }),
    });
  }
  if (filters.contactAvailability.hasWhatsApp) {
    badges.push({
      id: 'contact-hasWhatsApp',
      label: 'Has WhatsApp',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          contactAvailability: { ...filters.contactAvailability, hasWhatsApp: false },
        }),
    });
  }

  // Digital Presence
  if (filters.digitalPresence.googleBusinessProfile !== 'all') {
    badges.push({
      id: `gmb-${filters.digitalPresence.googleBusinessProfile}`,
      label: `GMB: ${filters.digitalPresence.googleBusinessProfile.replace('_', ' ')}`,
      onRemove: () =>
        onFiltersChange({
          ...filters,
          digitalPresence: { ...filters.digitalPresence, googleBusinessProfile: 'all' },
        }),
    });
  }
  if (filters.digitalPresence.websiteAvailable) {
    badges.push({
      id: 'digital-webAvailable',
      label: 'Website Available',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          digitalPresence: { ...filters.digitalPresence, websiteAvailable: false },
        }),
    });
  }
  if (filters.digitalPresence.websiteMissing) {
    badges.push({
      id: 'digital-webMissing',
      label: 'Website Missing',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          digitalPresence: { ...filters.digitalPresence, websiteMissing: false },
        }),
    });
  }
  if (filters.digitalPresence.socialMediaAvailable) {
    badges.push({
      id: 'digital-socialMedia',
      label: 'Social Media Profile',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          digitalPresence: { ...filters.digitalPresence, socialMediaAvailable: false },
        }),
    });
  }

  // Business Status
  if (filters.businessStatus.active) {
    badges.push({
      id: 'status-active',
      label: 'Active Records Only',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          businessStatus: { ...filters.businessStatus, active: false },
        }),
    });
  }
  if (filters.businessStatus.verified) {
    badges.push({
      id: 'status-verified',
      label: 'MCA / Govt Verified',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          businessStatus: { ...filters.businessStatus, verified: false },
        }),
    });
  }
  if (filters.businessStatus.completeProfile) {
    badges.push({
      id: 'status-complete',
      label: 'Complete Profile',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          businessStatus: { ...filters.businessStatus, completeProfile: false },
        }),
    });
  }
  if (filters.businessStatus.recentlyUpdated) {
    badges.push({
      id: 'status-updated',
      label: 'Recently Updated',
      onRemove: () =>
        onFiltersChange({
          ...filters,
          businessStatus: { ...filters.businessStatus, recentlyUpdated: false },
        }),
    });
  }

  // Quality / Orion Score Range & Tier
  if (filters.orionScoreTier !== 'all') {
    badges.push({
      id: `score-tier-${filters.orionScoreTier}`,
      label: `Score Tier: ${filters.orionScoreTier.toUpperCase()}`,
      onRemove: () =>
        onFiltersChange({
          ...filters,
          orionScoreTier: 'all',
          orionScoreRange: [0, 100],
        }),
    });
  } else if (filters.orionScoreRange[0] > 0 || filters.orionScoreRange[1] < 100) {
    badges.push({
      id: 'score-range',
      label: `Score: ${filters.orionScoreRange[0]}-${filters.orionScoreRange[1]}`,
      onRemove: () => onFiltersChange({ ...filters, orionScoreRange: [0, 100] }),
    });
  }

  // Quick Filter Chips
  if (activeChips.length > 0 && onToggleChip) {
    activeChips.forEach((chip) => {
      const chipLabels: Record<string, string> = {
        new_today: 'New Today',
        added_this_week: 'Added This Week',
        added_this_month: 'Added This Month',
        no_website: 'No Website',
        has_website: 'Has Website',
        has_email: 'Has Email',
        has_phone: 'Has Phone',
        verified: 'Verified',
        high_orion_score: 'High Quality Score (80+)',
      };
      badges.push({
        id: `chip-${chip}`,
        label: `Chip: ${chipLabels[chip] || chip}`,
        onRemove: () => onToggleChip(chip),
      });
    });
  }

  if (badges.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-1.5 flex-wrap text-xs bg-zinc-50 dark:bg-zinc-900/60 p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 ${className}`}
    >
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-1">
        Active Filters ({badges.length}):
      </span>

      {badges.map((b) => (
        <span
          key={b.id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs border border-zinc-200 dark:border-zinc-700 font-medium shadow-2xs"
        >
          <span>{b.label}</span>
          <button
            type="button"
            onClick={b.onRemove}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white p-0.5 rounded transition cursor-pointer"
            title={`Remove ${b.label}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={onClearAll}
        className="ml-auto text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-200/60 dark:hover:bg-zinc-800 transition cursor-pointer"
      >
        <RotateCcw className="w-3 h-3" />
        <span>Clear All</span>
      </button>
    </div>
  );
}
