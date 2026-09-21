'use client';

import { useState, useEffect } from 'react';

export interface FilterOption {
  id: string;
  label: string;
  value: string;
  description?: string;
  parentValue?: string; // For linking sub-industries to parent industries
  iconName?: string; // Icon name for quick filter chips or categories
  isActive: boolean;
  displayOrder: number;
  isSystem?: boolean;
}

export interface FilterCategory {
  id: string; // e.g. 'quick_filters', 'industries', 'sub_industries', 'business_categories', 'business_types', 'msme_categories', 'contact_availability', 'business_age', 'orion_score', or custom
  name: string;
  description?: string;
  type: 'chip' | 'multi_select' | 'single_select' | 'boolean_toggle' | 'range';
  isSystem?: boolean;
  isActive: boolean;
  options: FilterOption[];
}

export interface FilterOptionsConfig {
  categories: FilterCategory[];
  lastUpdated: string;
}

export const STORAGE_KEY = 'orion_dynamic_filter_options_v1';
export const EVENT_NAME = 'orion_filter_options_updated';

export const DEFAULT_FILTER_CONFIG: FilterOptionsConfig = {
  lastUpdated: new Date().toISOString(),
  categories: [
    {
      id: 'quick_filters',
      name: 'Quick Filter Chips',
      description: 'Prominent filter chips displayed horizontally above search results',
      type: 'chip',
      isSystem: true,
      isActive: true,
      options: [
        { id: 'qf_new_today', label: 'New Today', value: 'new_today', iconName: 'Sparkles', isActive: true, displayOrder: 1, isSystem: true },
        { id: 'qf_this_week', label: 'Added This Week', value: 'added_this_week', iconName: 'Calendar', isActive: true, displayOrder: 2, isSystem: true },
        { id: 'qf_this_month', label: 'Added This Month', value: 'added_this_month', iconName: 'Calendar', isActive: true, displayOrder: 3, isSystem: true },
        { id: 'qf_no_website', label: 'No Website', value: 'no_website', iconName: 'Globe2', isActive: true, displayOrder: 4, isSystem: true },
        { id: 'qf_has_website', label: 'Has Website', value: 'has_website', iconName: 'Globe', isActive: true, displayOrder: 5, isSystem: true },
        { id: 'qf_has_email', label: 'Has Email', value: 'has_email', iconName: 'Mail', isActive: true, displayOrder: 6, isSystem: true },
        { id: 'qf_has_phone', label: 'Has Phone', value: 'has_phone', iconName: 'Phone', isActive: true, displayOrder: 7, isSystem: true },
        { id: 'qf_verified', label: 'Verified', value: 'verified', iconName: 'ShieldCheck', isActive: true, displayOrder: 8, isSystem: true },
        { id: 'qf_high_score', label: 'High Orion Score', value: 'high_orion_score', iconName: 'TrendingUp', isActive: true, displayOrder: 9, isSystem: true },
      ],
    },
    {
      id: 'industries',
      name: 'Industry Sectors',
      description: 'Primary corporate sectors for business classification',
      type: 'multi_select',
      isSystem: true,
      isActive: true,
      options: [
        { id: 'ind_mfg', label: 'Manufacturing & Industrial', value: 'Manufacturing & Industrial', isActive: true, displayOrder: 1, isSystem: true },
        { id: 'ind_ws', label: 'Wholesale & Distribution', value: 'Wholesale & Distribution', isActive: true, displayOrder: 2, isSystem: true },
        { id: 'ind_mach', label: 'Machinery & Equipment', value: 'Machinery & Equipment', isActive: true, displayOrder: 3, isSystem: true },
        { id: 'ind_pkg', label: 'Packaging & Materials', value: 'Packaging & Materials', isActive: true, displayOrder: 4, isSystem: true },
        { id: 'ind_log', label: 'Logistics & Warehousing', value: 'Logistics & Warehousing', isActive: true, displayOrder: 5, isSystem: true },
        { id: 'ind_const', label: 'Construction & Real Estate', value: 'Construction & Real Estate', isActive: true, displayOrder: 6, isSystem: true },
        { id: 'ind_arch', label: 'Architecture & Interiors', value: 'Architecture & Interiors', isActive: true, displayOrder: 7, isSystem: true },
        { id: 'ind_ca', label: 'Chartered Accountancy & Tax', value: 'Chartered Accountancy & Tax', isActive: true, displayOrder: 8, isSystem: true },
        { id: 'ind_consult', label: 'Consulting & Advisory', value: 'Consulting & Advisory', isActive: true, displayOrder: 9, isSystem: true },
        { id: 'ind_hr', label: 'HR & Staffing Services', value: 'HR & Staffing Services', isActive: true, displayOrder: 10, isSystem: true },
        { id: 'ind_fin', label: 'Banking & Financial Services', value: 'Banking & Financial Services', isActive: true, displayOrder: 11, isSystem: true },
        { id: 'ind_ins', label: 'Insurance Services', value: 'Insurance Services', isActive: true, displayOrder: 12, isSystem: true },
        { id: 'ind_it', label: 'Software & IT Services', value: 'Software & IT Services', isActive: true, displayOrder: 13, isSystem: true },
        { id: 'ind_mkt', label: 'Marketing & Advertising', value: 'Marketing & Advertising', isActive: true, displayOrder: 14, isSystem: true },
        { id: 'ind_health', label: 'Healthcare & Pharmaceuticals', value: 'Healthcare & Pharmaceuticals', isActive: true, displayOrder: 15, isSystem: true },
        { id: 'ind_edu', label: 'Education & Training', value: 'Education & Training', isActive: true, displayOrder: 16, isSystem: true },
        { id: 'ind_print', label: 'Printing & Publishing', value: 'Printing & Publishing', isActive: true, displayOrder: 17, isSystem: true },
        { id: 'ind_tex', label: 'Textiles & Garments', value: 'Textiles & Garments', isActive: true, displayOrder: 18, isSystem: true },
        { id: 'ind_chem', label: 'Chemicals & Polymers', value: 'Chemicals & Polymers', isActive: true, displayOrder: 19, isSystem: true },
        { id: 'ind_auto', label: 'Automobile & Components', value: 'Automobile & Components', isActive: true, displayOrder: 20, isSystem: true },
        { id: 'ind_food', label: 'Food Processing & Agro', value: 'Food Processing & Agro', isActive: true, displayOrder: 21, isSystem: true },
        { id: 'ind_hosp', label: 'Hospitality & Catering', value: 'Hospitality & Catering', isActive: true, displayOrder: 22, isSystem: true },
        { id: 'ind_export', label: 'Export & Import Trading', value: 'Export & Import Trading', isActive: true, displayOrder: 23, isSystem: true },
        { id: 'ind_retail', label: 'Retail & Supermarkets', value: 'Retail & Supermarkets', isActive: true, displayOrder: 24, isSystem: true },
      ],
    },
    {
      id: 'sub_industries',
      name: 'Sub-Industries',
      description: 'Specialized verticals mapped under primary industry sectors',
      type: 'multi_select',
      isSystem: true,
      isActive: true,
      options: [
        { id: 'sub_cnc', label: 'CNC Machining', value: 'CNC Machining', parentValue: 'Manufacturing & Industrial', isActive: true, displayOrder: 1, isSystem: true },
        { id: 'sub_fab', label: 'Fabrication', value: 'Fabrication', parentValue: 'Manufacturing & Industrial', isActive: true, displayOrder: 2, isSystem: true },
        { id: 'sub_mold', label: 'Plastics Molding', value: 'Plastics Molding', parentValue: 'Manufacturing & Industrial', isActive: true, displayOrder: 3, isSystem: true },
        { id: 'sub_sheet', label: 'Sheet Metal', value: 'Sheet Metal', parentValue: 'Manufacturing & Industrial', isActive: true, displayOrder: 4, isSystem: true },
        { id: 'sub_cast', label: 'Foundry & Casting', value: 'Foundry & Casting', parentValue: 'Manufacturing & Industrial', isActive: true, displayOrder: 5, isSystem: true },
        { id: 'sub_fmcg', label: 'FMCG Wholesale', value: 'FMCG Wholesale', parentValue: 'Wholesale & Distribution', isActive: true, displayOrder: 6, isSystem: true },
        { id: 'sub_indsup', label: 'Industrial Supplies', value: 'Industrial Supplies', parentValue: 'Wholesale & Distribution', isActive: true, displayOrder: 7, isSystem: true },
        { id: 'sub_bldmat', label: 'Building Materials', value: 'Building Materials', parentValue: 'Wholesale & Distribution', isActive: true, displayOrder: 8, isSystem: true },
        { id: 'sub_elecg', label: 'Electrical Goods', value: 'Electrical Goods', parentValue: 'Wholesale & Distribution', isActive: true, displayOrder: 9, isSystem: true },
        { id: 'sub_frt', label: 'Freight Forwarding', value: 'Freight Forwarding', parentValue: 'Logistics & Warehousing', isActive: true, displayOrder: 10, isSystem: true },
        { id: 'sub_cstor', label: 'Cold Storage', value: 'Cold Storage', parentValue: 'Logistics & Warehousing', isActive: true, displayOrder: 11, isSystem: true },
        { id: 'sub_3pl', label: '3PL Logistics', value: '3PL Logistics', parentValue: 'Logistics & Warehousing', isActive: true, displayOrder: 12, isSystem: true },
        { id: 'sub_flt', label: 'Fleet Operations', value: 'Fleet Operations', parentValue: 'Logistics & Warehousing', isActive: true, displayOrder: 13, isSystem: true },
        { id: 'sub_civ', label: 'Civil Contracting', value: 'Civil Contracting', parentValue: 'Construction & Real Estate', isActive: true, displayOrder: 14, isSystem: true },
        { id: 'sub_bld', label: 'Commercial Builders', value: 'Commercial Builders', parentValue: 'Construction & Real Estate', isActive: true, displayOrder: 15, isSystem: true },
        { id: 'sub_rmc', label: 'RMC Ready Mix', value: 'RMC Ready Mix', parentValue: 'Construction & Real Estate', isActive: true, displayOrder: 16, isSystem: true },
        { id: 'sub_audit', label: 'Auditing & Assurance', value: 'Auditing & Assurance', parentValue: 'Chartered Accountancy & Tax', isActive: true, displayOrder: 17, isSystem: true },
        { id: 'sub_gst', label: 'GST Filing', value: 'GST Filing', parentValue: 'Chartered Accountancy & Tax', isActive: true, displayOrder: 18, isSystem: true },
        { id: 'sub_erp', label: 'Enterprise ERP', value: 'Enterprise ERP', parentValue: 'Software & IT Services', isActive: true, displayOrder: 19, isSystem: true },
        { id: 'sub_cld', label: 'Cloud Solutions', value: 'Cloud Solutions', parentValue: 'Software & IT Services', isActive: true, displayOrder: 20, isSystem: true },
        { id: 'sub_yarn', label: 'Yarn Manufacturing', value: 'Yarn Manufacturing', parentValue: 'Textiles & Garments', isActive: true, displayOrder: 21, isSystem: true },
        { id: 'sub_gexp', label: 'Garment Export', value: 'Garment Export', parentValue: 'Textiles & Garments', isActive: true, displayOrder: 22, isSystem: true },
        { id: 'sub_spice', label: 'Spices & Condiments', value: 'Spices & Condiments', parentValue: 'Food Processing & Agro', isActive: true, displayOrder: 23, isSystem: true },
      ],
    },
    {
      id: 'business_categories',
      name: 'Business Categories',
      description: 'Commercial entity model and operational framework',
      type: 'multi_select',
      isSystem: true,
      isActive: true,
      options: [
        { id: 'cat_b2b_mfg', label: 'B2B Product Manufacturer', value: 'B2B Product Manufacturer', isActive: true, displayOrder: 1, isSystem: true },
        { id: 'cat_wholesaler', label: 'Authorized Distributor / Wholesaler', value: 'Authorized Distributor / Wholesaler', isActive: true, displayOrder: 2, isSystem: true },
        { id: 'cat_service', label: 'Service Provider / Agency', value: 'Service Provider / Agency', isActive: true, displayOrder: 3, isSystem: true },
        { id: 'cat_retailer', label: 'Retailer / Commercial Dealer', value: 'Retailer / Commercial Dealer', isActive: true, displayOrder: 4, isSystem: true },
        { id: 'cat_impexp', label: 'Import / Export Merchant', value: 'Import / Export Merchant', isActive: true, displayOrder: 5, isSystem: true },
        { id: 'cat_infra', label: 'Contractor / Infrastructure Firm', value: 'Contractor / Infrastructure Firm', isActive: true, displayOrder: 6, isSystem: true },
      ],
    },
    {
      id: 'business_types',
      name: 'Business Structure & Constitution',
      description: 'Legal constitution of the business entity',
      type: 'multi_select',
      isSystem: true,
      isActive: true,
      options: [
        { id: 'bt_pvt_ltd', label: 'Private Limited (Pvt Ltd)', value: 'Private Limited', isActive: true, displayOrder: 1, isSystem: true },
        { id: 'bt_pub_ltd', label: 'Public Limited', value: 'Public Limited', isActive: true, displayOrder: 2, isSystem: true },
        { id: 'bt_llp', label: 'LLP', value: 'LLP', isActive: true, displayOrder: 3, isSystem: true },
        { id: 'bt_sole_prop', label: 'Sole Proprietorship', value: 'Sole Proprietorship', isActive: true, displayOrder: 4, isSystem: true },
        { id: 'bt_partner', label: 'Partnership', value: 'Partnership', isActive: true, displayOrder: 5, isSystem: true },
        { id: 'bt_opc', label: 'One Person Company (OPC)', value: 'One Person Company (OPC)', isActive: true, displayOrder: 6, isSystem: true },
        { id: 'bt_trust', label: 'Trust / Society', value: 'Trust / Society', isActive: true, displayOrder: 7, isSystem: true },
      ],
    },
    {
      id: 'msme_categories',
      name: 'MSME Classification',
      description: 'Statutory Indian enterprise scale classification',
      type: 'multi_select',
      isSystem: true,
      isActive: true,
      options: [
        { id: 'msme_micro', label: 'Micro (< ₹1 Cr)', value: 'Micro (< ₹1 Cr)', description: 'Investment < ₹1 Cr, Turnover < ₹5 Cr', isActive: true, displayOrder: 1, isSystem: true },
        { id: 'msme_small', label: 'Small (₹1-10 Cr)', value: 'Small (₹1-10 Cr)', description: 'Investment < ₹10 Cr, Turnover < ₹50 Cr', isActive: true, displayOrder: 2, isSystem: true },
        { id: 'msme_medium', label: 'Medium (₹10-50 Cr)', value: 'Medium (₹10-50 Cr)', description: 'Investment < ₹50 Cr, Turnover < ₹250 Cr', isActive: true, displayOrder: 3, isSystem: true },
        { id: 'msme_large', label: 'Unregistered / Large Commercial', value: 'Unregistered / Large Commercial', isActive: true, displayOrder: 4, isSystem: true },
      ],
    },
  ],
};

let inMemoryFilterConfig: FilterOptionsConfig = DEFAULT_FILTER_CONFIG;

export function getFilterOptionsConfig(): FilterOptionsConfig {
  return inMemoryFilterConfig;
}

export function saveFilterOptionsConfig(config: FilterOptionsConfig): void {
  const payload: FilterOptionsConfig = {
    ...config,
    lastUpdated: new Date().toISOString(),
  };

  inMemoryFilterConfig = payload;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
  }

  if (typeof fetch !== 'undefined') {
    fetch('/api/v1/admin/filter-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
}

export function addCategory(categoryData: Omit<FilterCategory, 'id' | 'options'> & { id?: string }): FilterCategory {
  const current = getFilterOptionsConfig();
  const id = categoryData.id || `custom_cat_${Date.now()}`;
  const newCat: FilterCategory = {
    id,
    name: categoryData.name,
    description: categoryData.description || '',
    type: categoryData.type || 'multi_select',
    isSystem: false,
    isActive: true,
    options: [],
  };
  const updatedCategories = [...current.categories, newCat];
  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
  return newCat;
}

export function updateCategory(categoryId: string, updates: Partial<FilterCategory>): void {
  const current = getFilterOptionsConfig();
  const updatedCategories = current.categories.map((cat) => {
    if (cat.id === categoryId) {
      return { ...cat, ...updates };
    }
    return cat;
  });
  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
}

export function deleteCategory(categoryId: string): void {
  const current = getFilterOptionsConfig();
  const updatedCategories = current.categories.filter((cat) => cat.id !== categoryId);
  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
}

export function addOptionToCategory(categoryId: string, optionData: Omit<FilterOption, 'id'> & { id?: string }): FilterOption {
  const current = getFilterOptionsConfig();
  const optId = optionData.id || `opt_${Date.now()}`;
  const newOption: FilterOption = {
    id: optId,
    label: optionData.label,
    value: optionData.value || optionData.label,
    description: optionData.description || '',
    parentValue: optionData.parentValue,
    iconName: optionData.iconName,
    isActive: optionData.isActive !== false,
    displayOrder: optionData.displayOrder || 99,
    isSystem: false,
  };

  const updatedCategories = current.categories.map((cat) => {
    if (cat.id === categoryId) {
      return {
        ...cat,
        options: [...cat.options, newOption],
      };
    }
    return cat;
  });

  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
  return newOption;
}

export function updateOptionInCategory(categoryId: string, optionId: string, updates: Partial<FilterOption>): void {
  const current = getFilterOptionsConfig();
  const updatedCategories = current.categories.map((cat) => {
    if (cat.id === categoryId) {
      const updatedOptions = cat.options.map((opt) => {
        if (opt.id === optionId) {
          return { ...opt, ...updates };
        }
        return opt;
      });
      return { ...cat, options: updatedOptions };
    }
    return cat;
  });
  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
}

export function deleteOptionFromCategory(categoryId: string, optionId: string): void {
  const current = getFilterOptionsConfig();
  const updatedCategories = current.categories.map((cat) => {
    if (cat.id === categoryId) {
      return {
        ...cat,
        options: cat.options.filter((opt) => opt.id !== optionId),
      };
    }
    return cat;
  });
  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
}

export function toggleOptionActive(categoryId: string, optionId: string): void {
  const current = getFilterOptionsConfig();
  const updatedCategories = current.categories.map((cat) => {
    if (cat.id === categoryId) {
      const updatedOptions = cat.options.map((opt) => {
        if (opt.id === optionId) {
          return { ...opt, isActive: !opt.isActive };
        }
        return opt;
      });
      return { ...cat, options: updatedOptions };
    }
    return cat;
  });
  saveFilterOptionsConfig({ ...current, categories: updatedCategories });
}

export function resetFilterOptionsToDefault(): void {
  saveFilterOptionsConfig(DEFAULT_FILTER_CONFIG);
}

export function useFilterOptions() {
  const [config, setConfig] = useState<FilterOptionsConfig>(inMemoryFilterConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    fetch('/api/v1/discover/filter-options')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (isMounted && data?.data?.categories && Array.isArray(data.data.categories)) {
          const remoteConfig: FilterOptionsConfig = {
            categories: data.data.categories,
            lastUpdated: data.data.lastUpdated || new Date().toISOString(),
          };
          inMemoryFilterConfig = remoteConfig;
          setConfig(remoteConfig);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<FilterOptionsConfig>;
      if (customEvent.detail) {
        setConfig(customEvent.detail);
      } else {
        setConfig(getFilterOptionsConfig());
      }
    };

    window.addEventListener(EVENT_NAME, handleUpdate);

    return () => {
      isMounted = false;
      window.removeEventListener(EVENT_NAME, handleUpdate);
    };
  }, []);

  return { config, loading };
}
