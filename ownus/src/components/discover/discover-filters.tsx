'use client';
import { Linkedin } from '@/components/ui/linkedin-icon';

import React, { useState, useMemo } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft,
  RotateCcw, 
  Search, 
  MapPin, 
  Building2, 
  Calendar, 
  PhoneCall, 
  Globe, 
  Sparkles, 
  ShieldCheck, 
  Check, 
  X,
  Bookmark,
  Layers,
  Sliders,
  AlertCircle,
  CheckCircle2,
  Lock,
  Tag,
  Clock,
  Briefcase,
  SlidersHorizontal,
  Activity
} from 'lucide-react';
import { industries as staticIndustries, subIndustriesMap as staticSubIndustriesMap, businessCategories as staticBusinessCategories } from '@/lib/data/businesses';
import { INDIAN_STATES_AND_UTS } from '@/lib/data/india-locations';
import { cn } from '@/lib/utils';
import { useFilterOptions, FilterCategory, FilterOption } from '@/lib/filter-options-store';

export interface DiscoverFilterState {
  // Location (India)
  state: string; // Single Indian State / UT
  districts: string[]; // Selected Districts
  cities: string[]; // Selected Cities
  pincode: string; // 6-digit PIN code
  states?: string[];

  // Business Information
  businessNameQuery: string;
  industries: string[];
  subIndustries: string[];
  businessCategories: string[];
  businessTypes: string[];
  msmeCategories: string[];

  // Dynamic Custom Admin Category Filters
  customAdminFilters?: Record<string, string[]>;

  // Business Age & Recency
  agePreset: 'all' | 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'custom';
  customDateStart: string;
  customDateEnd: string;
  ageMaxMonths: number; // 0 to 36

  // Contact Availability
  contactAvailability: {
    hasWebsite: boolean;
    noWebsite: boolean;
    hasEmail: boolean;
    hasPhone: boolean;
    hasWhatsApp: boolean;
    hasLinkedIn: boolean;
  };

  // Digital Presence (Descriptive)
  digitalPresence: {
    googleBusinessProfile: 'all' | 'has_gmb' | 'claimed' | 'unclaimed';
    websiteAvailable: boolean;
    websiteMissing: boolean;
    socialMediaAvailable: boolean;
  };

  // Business Status
  businessStatus: {
    active: boolean;
    verified: boolean;
    completeProfile: boolean;
    recentlyUpdated: boolean;
  };

  // Lead Quality (Orion Score)
  orionScoreRange: [number, number];
  orionScoreTier: 'all' | 'high' | 'medium' | 'low';
}

export const initialFilterState: DiscoverFilterState = {
  state: '',
  districts: [],
  cities: [],
  pincode: '',
  states: [],

  businessNameQuery: '',
  industries: [],
  subIndustries: [],
  businessCategories: [],
  businessTypes: [],
  msmeCategories: [],
  customAdminFilters: {},

  agePreset: 'all',
  customDateStart: '',
  customDateEnd: '',
  ageMaxMonths: 36,

  contactAvailability: {
    hasWebsite: false,
    noWebsite: false,
    hasEmail: false,
    hasPhone: false,
    hasWhatsApp: false,
    hasLinkedIn: false,
  },

  digitalPresence: {
    googleBusinessProfile: 'all',
    websiteAvailable: false,
    websiteMissing: false,
    socialMediaAvailable: false,
  },

  businessStatus: {
    active: false,
    verified: false,
    completeProfile: false,
    recentlyUpdated: false,
  },

  orionScoreRange: [0, 100],
  orionScoreTier: 'all',
};

interface DiscoverFiltersProps {
  filters: DiscoverFilterState;
  onChange: (filters: DiscoverFilterState) => void;
  onReset: () => void;
  onSavePreset?: () => void;
  onToggleSidebar?: () => void;
  totalActiveFiltersCount: number;
  className?: string;
}

const BUSINESS_TYPE_OPTIONS = [
  'Private Limited',
  'Public Limited',
  'LLP',
  'Sole Proprietorship',
  'Partnership',
  'One Person Company (OPC)',
  'Trust / Society',
];

const MSME_OPTIONS = ['Micro (< ₹1 Cr)', 'Small (₹1-10 Cr)', 'Medium (₹10-50 Cr)'];

const AGE_PRESETS = [
  { id: 'all', label: 'Any Age' },
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7d', label: 'Last 7 Days' },
  { id: '30d', label: 'Last 30 Days' },
  { id: '90d', label: 'Last 90 Days' },
  { id: 'custom', label: 'Custom Range' },
];

export function DiscoverFilters({
  filters,
  onChange,
  onReset,
  onSavePreset,
  onToggleSidebar,
  totalActiveFiltersCount,
  className,
}: DiscoverFiltersProps) {
  // Accordion open states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    location: true,
    businessInfo: true,
    businessAge: true,
    contacts: true,
    digitalPresence: true,
    businessStatus: true,
    orionScore: true,
  });

  // Local search inputs
  const [industrySearch, setIndustrySearch] = useState('');
  const [subIndustrySearch, setSubIndustrySearch] = useState('');
  const [stateSearch, setStateSearch] = useState('');
  const [districtSearch, setDistrictSearch] = useState('');
  const [citySearch, setCitySearch] = useState('');

  // Dropdown open states for Location hierarchy
  const [isStateDropdownOpen, setIsStateDropdownOpen] = useState(false);
  const [isDistrictDropdownOpen, setIsDistrictDropdownOpen] = useState(false);
  const [isCityDropdownOpen, setIsCityDropdownOpen] = useState(false);

  // Selected State object
  const selectedStateData = useMemo(() => {
    return INDIAN_STATES_AND_UTS.find((s) => s.state === filters.state) || null;
  }, [filters.state]);

  // Available districts
  const availableDistricts = useMemo(() => {
    if (!selectedStateData) return [];
    return selectedStateData.districts;
  }, [selectedStateData]);

  // Available cities based on selected districts
  const availableCities = useMemo(() => {
    if (!selectedStateData || filters.districts.length === 0) return [];
    const matchedDistricts = selectedStateData.districts.filter((d) =>
      filters.districts.includes(d.name)
    );
    const citiesSet = new Set<string>();
    matchedDistricts.forEach((d) => {
      d.cities.forEach((c) => citiesSet.add(c));
    });
    return Array.from(citiesSet);
  }, [selectedStateData, filters.districts]);

  const { config } = useFilterOptions();

  // Dynamic Industries list from Admin Config
  const dynamicIndustries = useMemo(() => {
    const cat = config.categories.find((c) => c.id === 'industries');
    if (cat && cat.options && cat.options.length > 0) {
      return cat.options.filter((o) => o.isActive !== false).map((o) => o.value || o.label);
    }
    return staticIndustries;
  }, [config]);

  // Dynamic Sub-Industries list & map from Admin Config
  const dynamicSubIndustriesMap = useMemo(() => {
    const cat = config.categories.find((c) => c.id === 'sub_industries');
    if (cat && cat.options && cat.options.length > 0) {
      const map: Record<string, string[]> = {};
      cat.options.filter((o) => o.isActive !== false).forEach((o) => {
        const parent = o.parentValue || 'General';
        if (!map[parent]) map[parent] = [];
        map[parent].push(o.value || o.label);
      });
      return map;
    }
    return staticSubIndustriesMap;
  }, [config]);

  // Dynamic Business Categories from Admin Config
  const dynamicBusinessCategories = useMemo(() => {
    const cat = config.categories.find((c) => c.id === 'business_categories');
    if (cat && cat.options && cat.options.length > 0) {
      return cat.options.filter((o) => o.isActive !== false).map((o) => o.value || o.label);
    }
    return staticBusinessCategories;
  }, [config]);

  // Dynamic Business Types from Admin Config
  const dynamicBusinessTypes = useMemo(() => {
    const cat = config.categories.find((c) => c.id === 'business_types');
    if (cat && cat.options && cat.options.length > 0) {
      return cat.options.filter((o) => o.isActive !== false).map((o) => o.value || o.label);
    }
    return BUSINESS_TYPE_OPTIONS;
  }, [config]);

  // Dynamic MSME Categories from Admin Config
  const dynamicMsmeCategories = useMemo(() => {
    const cat = config.categories.find((c) => c.id === 'msme_categories');
    if (cat && cat.options && cat.options.length > 0) {
      return cat.options.filter((o) => o.isActive !== false).map((o) => o.value || o.label);
    }
    return MSME_OPTIONS;
  }, [config]);

  // Custom Admin-created Categories
  const customAdminCategories = useMemo(() => {
    const knownIds = new Set(['quick_filters', 'industries', 'sub_industries', 'business_categories', 'business_types', 'msme_categories', 'location_masters', 'business_age', 'contact_availability', 'digital_presence', 'business_status', 'orion_score']);
    return config.categories.filter((c) => !knownIds.has(c.id) && c.isActive !== false);
  }, [config]);

  // Available sub-industries based on selected industries
  const availableSubIndustries = useMemo(() => {
    if (filters.industries.length === 0) {
      const allSubs = new Set<string>();
      Object.values(dynamicSubIndustriesMap).forEach((list) => list.forEach((s) => allSubs.add(s)));
      return Array.from(allSubs);
    }
    const subs = new Set<string>();
    filters.industries.forEach((ind) => {
      if (dynamicSubIndustriesMap[ind]) {
        dynamicSubIndustriesMap[ind].forEach((s) => subs.add(s));
      }
    });
    return Array.from(subs);
  }, [filters.industries, dynamicSubIndustriesMap]);

  // Location searches
  const filteredStatesList = useMemo(() => {
    const q = stateSearch.toLowerCase().trim();
    if (!q) return INDIAN_STATES_AND_UTS;
    return INDIAN_STATES_AND_UTS.filter((s) => s.state.toLowerCase().includes(q));
  }, [stateSearch]);

  const filteredDistrictsList = useMemo(() => {
    const q = districtSearch.toLowerCase().trim();
    if (!q) return availableDistricts;
    return availableDistricts.filter((d) => d.name.toLowerCase().includes(q));
  }, [availableDistricts, districtSearch]);

  const filteredCitiesList = useMemo(() => {
    const q = citySearch.toLowerCase().trim();
    if (!q) return availableCities;
    return availableCities.filter((c) => c.toLowerCase().includes(q));
  }, [availableCities, citySearch]);

  // Industry search
  const filteredIndustries = useMemo(() => {
    const q = industrySearch.toLowerCase().trim();
    if (!q) return dynamicIndustries;
    return dynamicIndustries.filter((ind) => ind.toLowerCase().includes(q));
  }, [industrySearch, dynamicIndustries]);

  const filteredSubIndustries = useMemo(() => {
    const q = subIndustrySearch.toLowerCase().trim();
    if (!q) return availableSubIndustries;
    return availableSubIndustries.filter((s) => s.toLowerCase().includes(q));
  }, [availableSubIndustries, subIndustrySearch]);

  // PIN validation
  const pincodeValidation = useMemo(() => {
    const pin = (filters.pincode || '').trim();
    if (!pin) return { status: 'idle', message: '' };
    if (!/^\d+$/.test(pin)) {
      return { status: 'invalid', message: 'Numbers only' };
    }
    if (pin.length < 6) {
      return { status: 'incomplete', message: `${pin.length}/6 digits` };
    }
    if (pin.length === 6) {
      if (pin.startsWith('0')) {
        return { status: 'invalid', message: 'Cannot start with 0' };
      }
      return { status: 'valid', message: 'Valid 6-digit Indian PIN' };
    }
    return { status: 'invalid', message: 'Max 6 digits' };
  }, [filters.pincode]);

  // Accordion toggle helpers
  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const expandAll = () => {
    setOpenSections({
      location: true,
      businessInfo: true,
      businessAge: true,
      contacts: true,
      digitalPresence: true,
      businessStatus: true,
      orionScore: true,
    });
  };

  const collapseAll = () => {
    setOpenSections({
      location: false,
      businessInfo: false,
      businessAge: false,
      contacts: false,
      digitalPresence: false,
      businessStatus: false,
      orionScore: false,
    });
  };

  // Location handlers
  const handleSelectState = (stateName: string) => {
    onChange({
      ...filters,
      state: stateName,
      districts: [],
      cities: [],
      states: stateName ? [stateName] : [],
    });
    setIsStateDropdownOpen(false);
    setStateSearch('');
  };

  const handleClearState = () => {
    onChange({
      ...filters,
      state: '',
      districts: [],
      cities: [],
      states: [],
    });
    setIsStateDropdownOpen(false);
    setIsDistrictDropdownOpen(false);
    setIsCityDropdownOpen(false);
  };

  const handleToggleDistrict = (districtName: string) => {
    const current = filters.districts || [];
    const next = current.includes(districtName)
      ? current.filter((d) => d !== districtName)
      : [...current, districtName];

    if (selectedStateData) {
      const remainingDistricts = selectedStateData.districts.filter((d) => next.includes(d.name));
      const allowedCities = new Set<string>();
      remainingDistricts.forEach((d) => d.cities.forEach((c) => allowedCities.add(c)));
      const nextCities = (filters.cities || []).filter((c) => allowedCities.has(c));

      onChange({ ...filters, districts: next, cities: nextCities });
    } else {
      onChange({ ...filters, districts: next });
    }
  };

  const handleSelectAllDistricts = () => {
    onChange({ ...filters, districts: availableDistricts.map((d) => d.name) });
  };

  const handleClearDistricts = () => {
    onChange({ ...filters, districts: [], cities: [] });
    setIsCityDropdownOpen(false);
  };

  const handleToggleCity = (cityName: string) => {
    const current = filters.cities || [];
    const next = current.includes(cityName)
      ? current.filter((c) => c !== cityName)
      : [...current, cityName];
    onChange({ ...filters, cities: next });
  };

  const handleSelectAllCities = () => {
    onChange({ ...filters, cities: [...availableCities] });
  };

  const handleClearCities = () => {
    onChange({ ...filters, cities: [] });
  };

  const handlePincodeChange = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 6);
    onChange({ ...filters, pincode: cleaned });
  };

  const toggleIndustry = (ind: string) => {
    const next = filters.industries.includes(ind)
      ? filters.industries.filter((i) => i !== ind)
      : [...filters.industries, ind];
    onChange({ ...filters, industries: next });
  };

  const toggleSubIndustry = (sub: string) => {
    const next = filters.subIndustries.includes(sub)
      ? filters.subIndustries.filter((s) => s !== sub)
      : [...filters.subIndustries, sub];
    onChange({ ...filters, subIndustries: next });
  };

  const toggleCategory = (cat: string) => {
    const next = filters.businessCategories.includes(cat)
      ? filters.businessCategories.filter((c) => c !== cat)
      : [...filters.businessCategories, cat];
    onChange({ ...filters, businessCategories: next });
  };

  const toggleBusinessType = (type: string) => {
    const next = filters.businessTypes.includes(type)
      ? filters.businessTypes.filter((t) => t !== type)
      : [...filters.businessTypes, type];
    onChange({ ...filters, businessTypes: next });
  };

  const toggleMsme = (msme: string) => {
    const next = filters.msmeCategories.includes(msme)
      ? filters.msmeCategories.filter((m) => m !== msme)
      : [...filters.msmeCategories, msme];
    onChange({ ...filters, msmeCategories: next });
  };

  return (
    <aside className={cn("w-full h-full flex flex-col bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xs overflow-hidden", className)}>
      {/* Sidebar Header */}
      <div className="p-3.5 sm:p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-900 shadow-xs shrink-0">
            <Sliders className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
              Filters
              {totalActiveFiltersCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                  {totalActiveFiltersCount}
                </span>
              )}
            </h2>

            {/* Save Icon pushed near Filters */}
            {onSavePreset && (
              <button
                onClick={onSavePreset}
                title="Save current filters"
                className="p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded-md transition-colors text-xs flex items-center gap-1 cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {totalActiveFiltersCount > 0 && (
            <button
              onClick={onReset}
              title="Reset all filters"
              className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-white hover:underline flex items-center gap-1 px-1.5 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}

          {/* Arrow to hide sidebar */}
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              title="Hide filter bar"
              className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800 transition-colors text-xs flex items-center justify-center cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Accordion Controls */}
      <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/30 dark:bg-zinc-900/20 flex items-center justify-between text-[11px] text-zinc-500">
        <button
          onClick={expandAll}
          className="hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors font-medium cursor-pointer"
        >
          Expand All
        </button>
        <span>•</span>
        <button
          onClick={collapseAll}
          className="hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors font-medium cursor-pointer"
        >
          Collapse All
        </button>
      </div>

      {/* Filter Sections Scroll Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
        
        {/* 1. LOCATION (INDIA HIERARCHY) */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('location')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-zinc-500" />
              Location (India)
              {(filters.state || filters.pincode) && (
                <span className="w-2 h-2 rounded-full bg-zinc-900 dark:bg-white" />
              )}
            </span>
            {openSections.location ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.location && (
            <div className="mt-3 space-y-3 pt-1">
              
              {/* State */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
                  <span>State / Union Territory</span>
                  {filters.state && (
                    <button onClick={handleClearState} className="text-[10px] text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                      Clear
                    </button>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsStateDropdownOpen(!isStateDropdownOpen)}
                    className="w-full px-2.5 py-1.5 text-left bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md flex items-center justify-between hover:border-zinc-300 transition-colors cursor-pointer"
                  >
                    <span className={`truncate text-xs ${filters.state ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-400'}`}>
                      {filters.state || 'Select State / UT...'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-zinc-400 shrink-0" />
                  </button>

                  {isStateDropdownOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden">
                      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800 relative">
                        <Search className="w-3 h-3 absolute left-4 top-3 text-zinc-400" />
                        <input
                          type="text"
                          placeholder="Search 28 States & 8 UTs..."
                          value={stateSearch}
                          onChange={(e) => setStateSearch(e.target.value)}
                          autoFocus
                          className="w-full pl-6 pr-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded focus:outline-hidden"
                        />
                      </div>
                      <div className="max-h-44 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/60">
                        {filteredStatesList.map((s) => (
                          <button
                            key={s.state}
                            onClick={() => handleSelectState(s.state)}
                            className={`w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ${
                              filters.state === s.state ? 'bg-zinc-100 dark:bg-zinc-800 font-semibold' : ''
                            }`}
                          >
                            <span>{s.state}</span>
                            {filters.state === s.state && <Check className="w-3 h-3" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* District */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
                  <span>District(s)</span>
                  {filters.districts.length > 0 && (
                    <button onClick={handleClearDistricts} className="text-[10px] text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                      Clear ({filters.districts.length})
                    </button>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    disabled={!filters.state}
                    onClick={() => setIsDistrictDropdownOpen(!isDistrictDropdownOpen)}
                    className={`w-full px-2.5 py-1.5 text-left border rounded-md flex items-center justify-between ${
                      !filters.state
                        ? 'bg-zinc-100 dark:bg-zinc-900/40 text-zinc-400 cursor-not-allowed opacity-60'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 cursor-pointer'
                    }`}
                  >
                    <span className="truncate text-xs">
                      {!filters.state ? 'Select State first...' : filters.districts.length === 0 ? 'Select Districts...' : `${filters.districts.length} Selected`}
                    </span>
                    <ChevronDown className="w-3 h-3 text-zinc-400" />
                  </button>

                  {isDistrictDropdownOpen && filters.state && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden">
                      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800 space-y-1">
                        <input
                          type="text"
                          placeholder="Search districts..."
                          value={districtSearch}
                          onChange={(e) => setDistrictSearch(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded focus:outline-hidden"
                        />
                        <div className="flex justify-between text-[10px] text-zinc-500 px-0.5">
                          <button onClick={handleSelectAllDistricts} className="hover:underline">Select All</button>
                          <button onClick={handleClearDistricts} className="text-zinc-600 dark:text-zinc-400 hover:underline">Clear</button>
                        </div>
                      </div>
                      <div className="max-h-40 overflow-y-auto p-1 divide-y divide-zinc-100 dark:divide-zinc-800">
                        {filteredDistrictsList.map((d) => (
                          <label key={d.name} className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.districts.includes(d.name)}
                              onChange={() => handleToggleDistrict(d.name)}
                              className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                            />
                            <span className="truncate">{d.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* City */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500">
                  <span>City / Hub(s)</span>
                  {filters.cities.length > 0 && (
                    <button onClick={handleClearCities} className="text-[10px] text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
                      Clear ({filters.cities.length})
                    </button>
                  )}
                </div>
                <div className="relative">
                  <button
                    type="button"
                    disabled={filters.districts.length === 0}
                    onClick={() => setIsCityDropdownOpen(!isCityDropdownOpen)}
                    className={`w-full px-2.5 py-1.5 text-left border rounded-md flex items-center justify-between ${
                      filters.districts.length === 0
                        ? 'bg-zinc-100 dark:bg-zinc-900/40 text-zinc-400 cursor-not-allowed opacity-60'
                        : 'bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 cursor-pointer'
                    }`}
                  >
                    <span className="truncate text-xs">
                      {filters.districts.length === 0 ? 'Select District first...' : filters.cities.length === 0 ? 'Select Cities...' : `${filters.cities.length} Selected`}
                    </span>
                    <ChevronDown className="w-3 h-3 text-zinc-400" />
                  </button>

                  {isCityDropdownOpen && filters.districts.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl overflow-hidden">
                      <div className="p-2 border-b border-zinc-100 dark:border-zinc-800 space-y-1">
                        <input
                          type="text"
                          placeholder="Search cities..."
                          value={citySearch}
                          onChange={(e) => setCitySearch(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded focus:outline-hidden"
                        />
                        <div className="flex justify-between text-[10px] text-zinc-500 px-0.5">
                          <button onClick={handleSelectAllCities} className="hover:underline">Select All</button>
                          <button onClick={handleClearCities} className="text-zinc-600 dark:text-zinc-400 hover:underline">Clear</button>
                        </div>
                      </div>
                      <div className="max-h-40 overflow-y-auto p-1 divide-y divide-zinc-100 dark:divide-zinc-800">
                        {filteredCitiesList.map((c) => (
                          <label key={c} className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={filters.cities.includes(c)}
                              onChange={() => handleToggleCity(c)}
                              className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                            />
                            <span className="truncate">{c}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Pincode */}
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-500 block">Pincode (Optional)</label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="e.g. 560001"
                  value={filters.pincode}
                  onChange={(e) => handlePincodeChange(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md font-mono focus:outline-hidden"
                />
                {pincodeValidation.status !== 'idle' && (
                  <span className="text-[10px] block text-zinc-700 dark:text-zinc-300 font-medium">
                    {pincodeValidation.message}
                  </span>
                )}
              </div>

            </div>
          )}
        </div>

        {/* 2. BUSINESS INFORMATION (UNIVERSAL DESCRIPTIVE) */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('businessInfo')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-zinc-500" />
              Business Information
              {filters.industries.length + filters.businessCategories.length + filters.businessTypes.length > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-medium">
                  {filters.industries.length + filters.businessCategories.length + filters.businessTypes.length}
                </span>
              )}
            </span>
            {openSections.businessInfo ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.businessInfo && (
            <div className="mt-3 space-y-3 pt-1">
              
              {/* Industry Multi-Select */}
              <div>
                <label className="text-[11px] font-medium text-zinc-500 block mb-1">Industry</label>
                <div className="relative mb-1.5">
                  <Search className="w-3 h-3 absolute left-2 top-2 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Search all industries..."
                    value={industrySearch}
                    onChange={(e) => setIndustrySearch(e.target.value)}
                    className="w-full pl-6 pr-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-md focus:outline-hidden"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto space-y-0.5 pr-1">
                  {filteredIndustries.map((ind) => (
                    <label
                      key={ind}
                      className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer text-zinc-700 dark:text-zinc-300 select-none text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={filters.industries.includes(ind)}
                        onChange={() => toggleIndustry(ind)}
                        className="rounded border-zinc-300 dark:border-zinc-700 text-zinc-900 focus:ring-0 w-3.5 h-3.5"
                      />
                      <span>{ind}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Sub-Industry / Specialization */}
              {availableSubIndustries.length > 0 && (
                <div>
                  <label className="text-[11px] font-medium text-zinc-500 block mb-1">Sub Industry / Sector</label>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {filteredSubIndustries.slice(0, 10).map((sub) => {
                      const isSelected = filters.subIndustries.includes(sub);
                      return (
                        <button
                          key={sub}
                          type="button"
                          onClick={() => toggleSubIndustry(sub)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900'
                              : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                          }`}
                        >
                          {sub}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Business Category */}
              <div>
                <label className="text-[11px] font-medium text-zinc-500 block mb-1">Business Category</label>
                <div className="space-y-1">
                  {dynamicBusinessCategories.map((cat) => (
                    <label
                      key={cat}
                      className="flex items-center gap-2 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer text-zinc-700 dark:text-zinc-300 select-none text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={filters.businessCategories.includes(cat)}
                        onChange={() => toggleCategory(cat)}
                        className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                      />
                      <span>{cat}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Entity Type */}
              <div>
                <label className="text-[11px] font-medium text-zinc-500 block mb-1">Business Type</label>
                <div className="flex flex-wrap gap-1">
                  {dynamicBusinessTypes.map((type) => {
                    const isSelected = filters.businessTypes.includes(type);
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => toggleBusinessType(type)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900'
                            : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* MSME Category */}
              <div>
                <label className="text-[11px] font-medium text-zinc-500 block mb-1">MSME Category</label>
                <div className="space-y-1">
                  {dynamicMsmeCategories.map((msme) => (
                    <label
                      key={msme}
                      className="flex items-center gap-2 px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer text-zinc-700 dark:text-zinc-300 select-none text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={filters.msmeCategories.includes(msme)}
                        onChange={() => toggleMsme(msme)}
                        className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                      />
                      <span>{msme}</span>
                    </label>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* 3. BUSINESS AGE & REGISTRATION RECENCY */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('businessAge')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-zinc-500" />
              Business Age & Recency
              {filters.agePreset !== 'all' && (
                <span className="px-1.5 py-0.2 text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-medium">
                  {filters.agePreset}
                </span>
              )}
            </span>
            {openSections.businessAge ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.businessAge && (
            <div className="mt-3 space-y-3 pt-1">
              {/* Presets */}
              <div className="grid grid-cols-2 gap-1">
                {AGE_PRESETS.map((pill) => (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => onChange({ ...filters, agePreset: pill.id as any })}
                    className={`px-2 py-1 rounded text-[11px] font-medium border text-center transition-all cursor-pointer ${
                      filters.agePreset === pill.id
                        ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900'
                        : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>

              {/* Custom Date Range */}
              {filters.agePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">From</label>
                    <input
                      type="date"
                      value={filters.customDateStart}
                      onChange={(e) => onChange({ ...filters, customDateStart: e.target.value })}
                      className="w-full px-2 py-1 text-[11px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">To</label>
                    <input
                      type="date"
                      value={filters.customDateEnd}
                      onChange={(e) => onChange({ ...filters, customDateEnd: e.target.value })}
                      className="w-full px-2 py-1 text-[11px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded"
                    />
                  </div>
                </div>
              )}

              {/* Age Max Months Slider */}
              <div className="pt-1">
                <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
                  <span>Age Slider:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {filters.ageMaxMonths >= 36 ? 'Any age' : `< ${filters.ageMaxMonths} months`}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="36"
                  value={filters.ageMaxMonths}
                  onChange={(e) => onChange({ ...filters, ageMaxMonths: Number(e.target.value) })}
                  className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-900 dark:accent-zinc-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* 4. CONTACT AVAILABILITY */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('contacts')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <PhoneCall className="w-3.5 h-3.5 text-zinc-500" />
              Contact Availability
            </span>
            {openSections.contacts ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.contacts && (
            <div className="mt-3 space-y-1.5 pt-1">
              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60">
                <span className="text-zinc-700 dark:text-zinc-300">Has Website</span>
                <input
                  type="checkbox"
                  checked={filters.contactAvailability.hasWebsite}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      contactAvailability: { ...filters.contactAvailability, hasWebsite: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60">
                <span className="text-zinc-700 dark:text-zinc-300">No Website</span>
                <input
                  type="checkbox"
                  checked={filters.contactAvailability.noWebsite}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      contactAvailability: { ...filters.contactAvailability, noWebsite: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60">
                <span className="text-zinc-700 dark:text-zinc-300">Has Email</span>
                <input
                  type="checkbox"
                  checked={filters.contactAvailability.hasEmail}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      contactAvailability: { ...filters.contactAvailability, hasEmail: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60">
                <span className="text-zinc-700 dark:text-zinc-300">Has Phone</span>
                <input
                  type="checkbox"
                  checked={filters.contactAvailability.hasPhone}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      contactAvailability: { ...filters.contactAvailability, hasPhone: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60">
                <span className="text-zinc-700 dark:text-zinc-300">Has WhatsApp</span>
                <input
                  type="checkbox"
                  checked={filters.contactAvailability.hasWhatsApp}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      contactAvailability: { ...filters.contactAvailability, hasWhatsApp: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60">
                <span className="text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5">
                  <Linkedin className="w-3.5 h-3.5 text-[#0A66C2]" />
                  Has LinkedIn
                </span>
                <input
                  type="checkbox"
                  checked={filters.contactAvailability.hasLinkedIn}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      contactAvailability: { ...filters.contactAvailability, hasLinkedIn: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>
            </div>
          )}
        </div>

        {/* 5. DIGITAL PRESENCE (DESCRIPTIVE) */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('digitalPresence')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-zinc-500" />
              Digital Presence
            </span>
            {openSections.digitalPresence ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.digitalPresence && (
            <div className="mt-3 space-y-2 pt-1">
              {/* Google Business Profile */}
              <div>
                <label className="text-[11px] font-medium text-zinc-500 block mb-1">Google Business Profile</label>
                <select
                  value={filters.digitalPresence.googleBusinessProfile}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      digitalPresence: {
                        ...filters.digitalPresence,
                        googleBusinessProfile: e.target.value as any,
                      },
                    })
                  }
                  className="w-full px-2 py-1 text-xs bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded"
                >
                  <option value="all">All / Any Status</option>
                  <option value="has_gmb">Has Google Profile</option>
                  <option value="claimed">Claimed Profile</option>
                  <option value="unclaimed">Unclaimed Profile</option>
                </select>
              </div>

              {/* Website Available / Missing */}
              <div className="space-y-1 pt-1">
                <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                  <span className="text-zinc-700 dark:text-zinc-300">Website Available</span>
                  <input
                    type="checkbox"
                    checked={filters.digitalPresence.websiteAvailable}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        digitalPresence: { ...filters.digitalPresence, websiteAvailable: e.target.checked },
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                  />
                </label>
                <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                  <span className="text-zinc-700 dark:text-zinc-300">Website Missing</span>
                  <input
                    type="checkbox"
                    checked={filters.digitalPresence.websiteMissing}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        digitalPresence: { ...filters.digitalPresence, websiteMissing: e.target.checked },
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                  />
                </label>
                <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                  <span className="text-zinc-700 dark:text-zinc-300">Social Media Available</span>
                  <input
                    type="checkbox"
                    checked={filters.digitalPresence.socialMediaAvailable}
                    onChange={(e) =>
                      onChange({
                        ...filters,
                        digitalPresence: { ...filters.digitalPresence, socialMediaAvailable: e.target.checked },
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* 6. BUSINESS STATUS */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('businessStatus')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-zinc-500" />
              Business Status
            </span>
            {openSections.businessStatus ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.businessStatus && (
            <div className="mt-3 space-y-1.5 pt-1">
              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">Active Business</span>
                <input
                  type="checkbox"
                  checked={filters.businessStatus.active}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      businessStatus: { ...filters.businessStatus, active: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">Verified Record</span>
                <input
                  type="checkbox"
                  checked={filters.businessStatus.verified}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      businessStatus: { ...filters.businessStatus, verified: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">Complete Profile</span>
                <input
                  type="checkbox"
                  checked={filters.businessStatus.completeProfile}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      businessStatus: { ...filters.businessStatus, completeProfile: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>

              <label className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer">
                <span className="text-zinc-700 dark:text-zinc-300 font-medium">Recently Updated</span>
                <input
                  type="checkbox"
                  checked={filters.businessStatus.recentlyUpdated}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      businessStatus: { ...filters.businessStatus, recentlyUpdated: e.target.checked },
                    })
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                />
              </label>
            </div>
          )}
        </div>

        {/* 7. LEAD QUALITY (ORION SCORE) */}
        <div className="p-3.5">
          <button
            onClick={() => toggleSection('orionScore')}
            className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
              Lead Quality (Orion Score)
            </span>
            {openSections.orionScore ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
          </button>

          {openSections.orionScore && (
            <div className="mt-3 space-y-3 pt-1">
              <div className="grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, orionScoreTier: 'high', orionScoreRange: [80, 100] })}
                  className={`px-2 py-1 rounded text-[10px] font-semibold border transition-all cursor-pointer ${
                    filters.orionScoreTier === 'high'
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  High (80-100)
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, orionScoreTier: 'medium', orionScoreRange: [50, 79] })}
                  className={`px-2 py-1 rounded text-[10px] font-semibold border transition-all cursor-pointer ${
                    filters.orionScoreTier === 'medium'
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  Med (50-79)
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ ...filters, orionScoreTier: 'all', orionScoreRange: [0, 100] })}
                  className={`px-2 py-1 rounded text-[10px] font-semibold border transition-all cursor-pointer ${
                    filters.orionScoreTier === 'all'
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 border-zinc-900 dark:border-white'
                      : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  All (0-100)
                </button>
              </div>

              <div>
                <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
                  <span>Min Score: {filters.orionScoreRange[0]}</span>
                  <span>Max: {filters.orionScoreRange[1]}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={filters.orionScoreRange[0]}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      orionScoreRange: [parseInt(e.target.value, 10), filters.orionScoreRange[1]],
                      orionScoreTier: 'all',
                    })
                  }
                  className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-900 dark:accent-zinc-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* 8. DYNAMIC CUSTOM ADMIN CATEGORIES */}
        {customAdminCategories.map((customCat) => {
          const selectedValues = filters.customAdminFilters?.[customCat.id] || [];
          const isOpen = Boolean(openSections[customCat.id] ?? true);
          const activeOptions = customCat.options.filter((o) => o.isActive !== false);

          return (
            <div key={customCat.id} className="p-3.5">
              <button
                onClick={() => toggleSection(customCat.id)}
                className="w-full flex items-center justify-between font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-950 dark:hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Tag className="w-3.5 h-3.5 text-zinc-500" />
                  {customCat.name}
                  {selectedValues.length > 0 && (
                    <span className="px-1.5 py-0.2 text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 rounded font-medium">
                      {selectedValues.length}
                    </span>
                  )}
                </span>
                {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
              </button>

              {isOpen && (
                <div className="mt-3 space-y-1.5 pt-1">
                  {activeOptions.map((opt) => {
                    const val = opt.value || opt.label;
                    const isChecked = selectedValues.includes(val);
                    return (
                      <label
                        key={opt.id}
                        className="flex items-center justify-between px-2 py-1 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer border border-zinc-200/60 dark:border-zinc-800/60"
                      >
                        <span className="text-zinc-700 dark:text-zinc-300 text-[11px]">{opt.label}</span>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const nextVals = isChecked
                              ? selectedValues.filter((v) => v !== val)
                              : [...selectedValues, val];
                            onChange({
                              ...filters,
                              customAdminFilters: {
                                ...(filters.customAdminFilters || {}),
                                [customCat.id]: nextVals,
                              },
                            });
                          }}
                          className="rounded border-zinc-300 dark:border-zinc-700 w-3.5 h-3.5"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

      </div>
    </aside>
  );
}
