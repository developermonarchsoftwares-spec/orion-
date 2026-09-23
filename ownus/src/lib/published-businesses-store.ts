'use client';

import { useState, useEffect } from 'react';
import { Business } from '@/lib/types';
import { AdminBusinessRecord } from '@/types/admin';

export const ORION_PUBLISHED_BUSINESSES_EVENT = 'orion_published_businesses_updated';

export const INITIAL_PUBLISHED_BUSINESSES: Business[] = [];

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
    linkedin: rec.linkedin || rec.linkedin_url || rec.linkedInUrl || null,
    linkedInUrl: rec.linkedin || rec.linkedin_url || rec.linkedInUrl || null,
    hasLinkedIn: Boolean(rec.linkedin || rec.linkedin_url || rec.linkedInUrl || rec.hasLinkedIn),
    linkedinStatus: (rec.linkedin || rec.linkedin_url || rec.linkedInUrl || rec.hasLinkedIn) ? 'available' : 'not_available',
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

export async function fetchPublishedBusinessesFromApi(): Promise<Business[]> {
  try {
    const res = await fetch('/api/v1/discover/search?limit=100', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    if (json?.data?.items && Array.isArray(json.data.items)) {
      return json.data.items.map(mapAdminRecordToCustomerBusiness);
    }
  } catch (e) {
    console.warn('[Published Businesses Store] API fetch warning:', e);
  }
  return [];
}

export function loadPublishedBusinessesFromStorage(): Business[] {
  return [];
}

export function savePublishedBusinessesToStorage(businesses: Business[]) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ORION_PUBLISHED_BUSINESSES_EVENT, { detail: businesses }));
  }
}

export function syncAdminRecordsToPublishedStore(adminRecords: AdminBusinessRecord[]) {
  const publishedOnly = adminRecords
    .filter((r) => r.status === 'published')
    .map(mapAdminRecordToCustomerBusiness);

  savePublishedBusinessesToStorage(publishedOnly);
}

export function usePublishedBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    fetchPublishedBusinessesFromApi().then((list) => {
      if (isMounted) {
        setBusinesses(list);
        setLoading(false);
      }
    });

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<Business[]>;
      if (customEvent.detail && Array.isArray(customEvent.detail)) {
        setBusinesses(customEvent.detail);
      } else {
        fetchPublishedBusinessesFromApi().then((list) => {
          if (isMounted) setBusinesses(list);
        });
      }
    };

    window.addEventListener(ORION_PUBLISHED_BUSINESSES_EVENT, handleUpdate);

    return () => {
      isMounted = false;
      window.removeEventListener(ORION_PUBLISHED_BUSINESSES_EVENT, handleUpdate);
    };
  }, []);

  return {
    publishedBusinesses: businesses,
    loading,
    setPublishedBusinesses: (newList: Business[]) => {
      setBusinesses(newList);
      savePublishedBusinessesToStorage(newList);
    },
    syncFromAdminRecords: (adminRecords: AdminBusinessRecord[]) => {
      syncAdminRecordsToPublishedStore(adminRecords);
    },
  };
}
