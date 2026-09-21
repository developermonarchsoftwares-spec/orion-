'use client';

import { useState, useEffect } from 'react';

export const ORION_UNLOCKED_LEADS_EVENT = 'orion_unlocked_leads_updated';

let inMemoryUnlockedSet = new Set<string>();

export async function fetchUnlockedLeadsFromApi(): Promise<Set<string>> {
  try {
    const res = await fetch('/api/v1/unlock/user-leads', { cache: 'no-store' });
    if (!res.ok) return inMemoryUnlockedSet;
    const json = await res.json();
    if (json?.data?.unlockedIds && Array.isArray(json.data.unlockedIds)) {
      inMemoryUnlockedSet = new Set(json.data.unlockedIds.map(String));
      return inMemoryUnlockedSet;
    }
  } catch (e) {
    console.warn('[Unlocked Leads Store] API fetch warning:', e);
  }
  return inMemoryUnlockedSet;
}

export function getUnlockedLeadIds(): Set<string> {
  return inMemoryUnlockedSet;
}

export function saveUnlockedLeadIds(ids: Set<string> | string[]) {
  const arr = Array.from(ids);
  inMemoryUnlockedSet = new Set(arr);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ORION_UNLOCKED_LEADS_EVENT, { detail: arr }));
  }
}

export function addUnlockedLeadId(businessId: string) {
  if (!businessId) return;
  inMemoryUnlockedSet.add(String(businessId));
  saveUnlockedLeadIds(inMemoryUnlockedSet);
}

export function addUnlockedLeadIds(businessIds: string[]) {
  if (!businessIds || businessIds.length === 0) return;
  businessIds.forEach((id) => inMemoryUnlockedSet.add(String(id)));
  saveUnlockedLeadIds(inMemoryUnlockedSet);
}

export function isLeadUnlocked(businessId: string): boolean {
  if (!businessId) return false;
  return inMemoryUnlockedSet.has(String(businessId));
}

export function applyUnlockedStatusToBusinesses<T extends { id: string; isUnlocked?: boolean; phone?: string | null; email?: string | null; phoneStatus?: string; emailStatus?: string }>(
  items: T[]
): T[] {
  if (!items || items.length === 0) return items;

  return items.map((item) => {
    if (item.isUnlocked || inMemoryUnlockedSet.has(String(item.id))) {
      return {
        ...item,
        isUnlocked: true,
        phoneStatus: item.phone ? 'available' : item.phoneStatus || 'available',
        emailStatus: item.email ? 'available' : item.emailStatus || 'available',
      };
    }
    return item;
  });
}

export function useUnlockedLeads() {
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(inMemoryUnlockedSet);

  useEffect(() => {
    let isMounted = true;
    fetchUnlockedLeadsFromApi().then((set) => {
      if (isMounted) setUnlockedIds(set);
    });

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (customEvent.detail && Array.isArray(customEvent.detail)) {
        const newSet = new Set(customEvent.detail);
        inMemoryUnlockedSet = newSet;
        setUnlockedIds(newSet);
      } else {
        fetchUnlockedLeadsFromApi().then((set) => {
          if (isMounted) setUnlockedIds(set);
        });
      }
    };

    window.addEventListener(ORION_UNLOCKED_LEADS_EVENT, handleUpdate);

    return () => {
      isMounted = false;
      window.removeEventListener(ORION_UNLOCKED_LEADS_EVENT, handleUpdate);
    };
  }, []);

  return {
    unlockedIds,
    isUnlocked: (businessId: string) => unlockedIds.has(String(businessId)),
    unlockLead: (businessId: string) => {
      addUnlockedLeadId(businessId);
    },
    unlockMultipleLeads: (businessIds: string[]) => {
      addUnlockedLeadIds(businessIds);
    },
    applyUnlockedStatus: <T extends { id: string; isUnlocked?: boolean }>(items: T[]) => {
      return items.map((item) => (unlockedIds.has(String(item.id)) ? { ...item, isUnlocked: true } : item));
    },
  };
}
