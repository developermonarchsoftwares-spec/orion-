'use client';

import { useState, useEffect } from 'react';
import { Business } from '@/lib/types';
import { AdminBusinessRecord } from '@/types/admin';

export const ORION_PUBLISHED_BUSINESSES_EVENT = 'orion_published_businesses_updated';
const LOCAL_STORAGE_KEY = 'orion_published_businesses_v1';

export const INITIAL_PUBLISHED_BUSINESSES: Business[] = [
  {
    id: 'BIZ-10001',
    name: 'Tata Consultancy Services',
    industry: 'Information Technology',
    subIndustry: 'IT Services & Consulting',
    category: 'IT Services & Consulting',
    city: 'Mumbai',
    district: 'Mumbai',
    state: 'Maharashtra',
    address: '9th Floor Nirmal Building Nariman Point',
    zipCode: '400021',
    pincode: '400021',
    phone: '+912267789999',
    email: 'corporate.office@tcs.com',
    website: 'https://www.tcs.com',
    phoneStatus: 'available',
    emailStatus: 'available',
    hasWhatsApp: true,
    verified: true,
    completeProfile: true,
    recentlyUpdated: true,
    entityType: 'Public Limited',
    businessType: 'Public Limited',
    msmeCategory: 'Medium',
    opportunityScore: 98,
    businessAge: '56 yrs',
    registrationDate: '1968-04-01',
    description: 'Global leader in IT services, digital and business solutions.',
    creditsRequired: 1,
    status: 'active',
    tags: ['Information Technology', 'IT Services & Consulting', 'Verified'],
  },
  {
    id: 'BIZ-10002',
    name: 'Infosys Limited',
    industry: 'Information Technology',
    subIndustry: 'Enterprise Software & AI',
    category: 'Enterprise Software & AI',
    city: 'Bangalore',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    address: 'Plot No 44 Electronics City Hosur Road',
    zipCode: '560100',
    pincode: '560100',
    phone: '+918028520261',
    email: 'investors@infosys.com',
    website: 'https://www.infosys.com',
    phoneStatus: 'available',
    emailStatus: 'available',
    hasWhatsApp: true,
    verified: true,
    completeProfile: true,
    recentlyUpdated: true,
    entityType: 'Public Limited',
    businessType: 'Public Limited',
    msmeCategory: 'Medium',
    opportunityScore: 96,
    businessAge: '43 yrs',
    registrationDate: '1981-07-02',
    description: 'Next-generation digital services and consulting.',
    creditsRequired: 1,
    status: 'active',
    tags: ['Information Technology', 'Enterprise Software & AI', 'Verified'],
  },
  {
    id: 'BIZ-10003',
    name: 'Wipro Limited',
    industry: 'Information Technology',
    subIndustry: 'Cloud & Business Transformation',
    category: 'Cloud & Business Transformation',
    city: 'Bangalore',
    district: 'Bengaluru Urban',
    state: 'Karnataka',
    address: 'Doddakannelli Sarjapur Road',
    zipCode: '560035',
    pincode: '560035',
    phone: '+918028440011',
    email: 'info@wipro.com',
    website: 'https://www.wipro.com',
    phoneStatus: 'available',
    emailStatus: 'available',
    hasWhatsApp: true,
    verified: true,
    completeProfile: true,
    recentlyUpdated: true,
    entityType: 'Public Limited',
    businessType: 'Public Limited',
    msmeCategory: 'Medium',
    opportunityScore: 94,
    businessAge: '79 yrs',
    registrationDate: '1945-12-29',
    description: 'Leading global information technology, consulting and business process services company.',
    creditsRequired: 1,
    status: 'active',
    tags: ['Information Technology', 'Cloud & Business Transformation', 'Verified'],
  },
  {
    id: 'BIZ-10004',
    name: 'HCL Technologies',
    industry: 'Information Technology',
    subIndustry: 'Digital Foundation & Engineering',
    category: 'Digital Foundation & Engineering',
    city: 'New Delhi',
    district: 'South East Delhi',
    state: 'Delhi',
    address: '806 Siddharth 96 Nehru Place',
    zipCode: '110019',
    pincode: '110019',
    phone: '+911204013000',
    email: 'investors@hcl.com',
    website: 'https://www.hcltech.com',
    phoneStatus: 'available',
    emailStatus: 'available',
    hasWhatsApp: true,
    verified: true,
    completeProfile: true,
    recentlyUpdated: true,
    entityType: 'Public Limited',
    businessType: 'Public Limited',
    msmeCategory: 'Medium',
    opportunityScore: 92,
    businessAge: '33 yrs',
    registrationDate: '1991-11-12',
    description: 'Global technology company helping enterprises reimagine their businesses.',
    creditsRequired: 1,
    status: 'active',
    tags: ['Information Technology', 'Digital Foundation & Engineering', 'Verified'],
  },
  {
    id: 'BIZ-10005',
    name: 'Tech Mahindra',
    industry: 'Information Technology',
    subIndustry: 'Telecommunications & Enterprise IT',
    category: 'Telecommunications & Enterprise IT',
    city: 'Mumbai',
    district: 'Mumbai',
    state: 'Maharashtra',
    address: 'Gateway Building Apollo Bunder',
    zipCode: '400001',
    pincode: '400001',
    phone: '+912066018100',
    email: 'investor.relations@techmahindra.com',
    website: 'https://www.techmahindra.com',
    phoneStatus: 'available',
    emailStatus: 'available',
    hasWhatsApp: true,
    verified: true,
    completeProfile: true,
    recentlyUpdated: true,
    entityType: 'Public Limited',
    businessType: 'Public Limited',
    msmeCategory: 'Medium',
    opportunityScore: 90,
    businessAge: '38 yrs',
    registrationDate: '1986-10-24',
    description: 'Offering innovative and customer-centric digital experiences.',
    creditsRequired: 1,
    status: 'active',
    tags: ['Information Technology', 'Telecommunications & Enterprise IT', 'Verified'],
  }
];

export function mapAdminRecordToCustomerBusiness(rec: any): Business {
  const isPublished = rec.status === 'published' || rec.status === 'approved' || rec.status === 'active';
  return {
    id: rec.id,
    name: rec.name || rec.business_name || 'Unnamed Enterprise',
    industry: rec.industry || 'Manufacturing & Industrial',
    subIndustry: rec.subIndustry || rec.category || '',
    category: rec.category || rec.subIndustry || 'Enterprise',
    city: rec.city || rec.district || 'India',
    district: rec.district || rec.city || '',
    state: rec.state || 'India',
    address: rec.address || rec.address_line1 || '',
    zipCode: rec.pincode || rec.zipCode || '',
    pincode: rec.pincode || rec.zipCode || '',
    website: rec.website || (rec.hasWebsite ? 'https://' : null),
    phone: rec.phone || null,
    email: rec.email || null,
    phoneStatus: rec.phone ? 'available' : 'not_available',
    emailStatus: rec.email ? 'available' : 'not_available',
    hasWhatsApp: Boolean(rec.whatsapp || rec.phone),
    verified: rec.validationStatus === 'Approved' || rec.validationStatus === 'Validated' || Boolean(rec.verified),
    completeProfile: Boolean(rec.phone && rec.email && (rec.address || rec.city)),
    recentlyUpdated: true,
    entityType: rec.businessType || rec.entityType || 'Private Limited',
    businessType: (rec.businessType || rec.entityType || 'Private Limited') as any,
    msmeCategory: (rec.msmeCategory || 'Medium') as any,
    opportunityScore: rec.opportunityScore ?? rec.dataQualityScore ?? rec.validationScore ?? 80,
    businessAge: rec.foundingYear ? `${new Date().getFullYear() - rec.foundingYear} yrs` : (rec.businessAge || 'Established'),
    registrationDate: rec.registrationDate || rec.createdAt || new Date().toISOString().split('T')[0],
    description: rec.description || '',
    creditsRequired: 1,
    status: isPublished ? 'active' : 'inactive',
    tags: rec.tags || [rec.industry || 'Enterprise', rec.category || 'Verified'].filter(Boolean),
  };
}

export function loadPublishedBusinessesFromStorage(): Business[] {
  if (typeof window === 'undefined') return INITIAL_PUBLISHED_BUSINESSES;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load published businesses from localStorage:', e);
  }
  return INITIAL_PUBLISHED_BUSINESSES;
}

export function savePublishedBusinessesToStorage(businesses: Business[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(businesses));
    window.dispatchEvent(new CustomEvent(ORION_PUBLISHED_BUSINESSES_EVENT, { detail: businesses }));
  } catch (e) {
    console.warn('Failed to save published businesses to localStorage:', e);
  }
}

export function syncAdminRecordsToPublishedStore(adminRecords: AdminBusinessRecord[]) {
  const publishedOnly = adminRecords
    .filter((r) => r.status === 'published')
    .map(mapAdminRecordToCustomerBusiness);

  savePublishedBusinessesToStorage(publishedOnly);
}

export function usePublishedBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>(loadPublishedBusinessesFromStorage);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<Business[]>;
      if (customEvent.detail && Array.isArray(customEvent.detail)) {
        setBusinesses(customEvent.detail);
      } else {
        setBusinesses(loadPublishedBusinessesFromStorage());
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_STORAGE_KEY) {
        setBusinesses(loadPublishedBusinessesFromStorage());
      }
    };

    window.addEventListener(ORION_PUBLISHED_BUSINESSES_EVENT, handleUpdate);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(ORION_PUBLISHED_BUSINESSES_EVENT, handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return {
    publishedBusinesses: businesses,
    setPublishedBusinesses: (newList: Business[]) => {
      setBusinesses(newList);
      savePublishedBusinessesToStorage(newList);
    },
    syncFromAdminRecords: (adminRecords: AdminBusinessRecord[]) => {
      syncAdminRecordsToPublishedStore(adminRecords);
    },
  };
}
