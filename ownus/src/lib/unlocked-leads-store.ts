'use client';

import { useState, useEffect } from 'react';

export const ORION_UNLOCKED_LEADS_EVENT = 'orion_unlocked_leads_updated';
const LOCAL_STORAGE_KEY = 'orion_unlocked_lead_ids_v1';

export function getUnlockedLeadIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr);
      }
    }
  } catch (e) {
    console.warn('Failed to parse unlocked lead IDs from localStorage:', e);
  }
  return new Set();
}

export function saveUnlockedLeadIds(ids: Set<string> | string[]) {
  if (typeof window === 'undefined') return;
  try {
    const arr = Array.from(ids);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(arr));
    window.dispatchEvent(new CustomEvent(ORION_UNLOCKED_LEADS_EVENT, { detail: arr }));
  } catch (e) {
    console.warn('Failed to save unlocked lead IDs to localStorage:', e);
  }
}

export function addUnlockedLeadId(businessId: string) {
  if (!businessId) return;
  const current = getUnlockedLeadIds();
  current.add(businessId);
  saveUnlockedLeadIds(current);
}

export function addUnlockedLeadIds(businessIds: string[]) {
  if (!businessIds || businessIds.length === 0) return;
  const current = getUnlockedLeadIds();
  businessIds.forEach((id) => current.add(id));
  saveUnlockedLeadIds(current);
}

export function isLeadUnlocked(businessId: string): boolean {
  if (!businessId) return false;
  const set = getUnlockedLeadIds();
  return set.has(businessId);
}

export function applyUnlockedStatusToBusinesses<T extends { id: string; isUnlocked?: boolean; phone?: string | null; email?: string | null; phoneStatus?: string; emailStatus?: string }>(
  items: T[]
): T[] {
  if (!items || items.length === 0) return items;
  const unlockedSet = getUnlockedLeadIds();
  if (unlockedSet.size === 0) return items;

  return items.map((item) => {
    if (unlockedSet.has(item.id)) {
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
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(getUnlockedLeadIds);

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<string[]>;
      if (customEvent.detail && Array.isArray(customEvent.detail)) {
        setUnlockedIds(new Set(customEvent.detail));
      } else {
        setUnlockedIds(getUnlockedLeadIds());
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_STORAGE_KEY) {
        setUnlockedIds(getUnlockedLeadIds());
      }
    };

    window.addEventListener(ORION_UNLOCKED_LEADS_EVENT, handleUpdate);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(ORION_UNLOCKED_LEADS_EVENT, handleUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return {
    unlockedIds,
    isUnlocked: (businessId: string) => unlockedIds.has(businessId),
    unlockLead: (businessId: string) => {
      addUnlockedLeadId(businessId);
    },
    unlockMultipleLeads: (businessIds: string[]) => {
      addUnlockedLeadIds(businessIds);
    },
    applyUnlockedStatus: <T extends { id: string; isUnlocked?: boolean }>(items: T[]) => {
      return items.map((item) => (unlockedIds.has(item.id) ? { ...item, isUnlocked: true } : item));
    },
  };
}
