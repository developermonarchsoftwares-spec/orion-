'use client';

import { 
  AdminBusinessRecord, 
  ImportBatch, 
  DuplicatePair, 
  ValidationIssue 
} from '@/types/admin';

export const ORION_ADMIN_DATA_EVENT = 'orion_admin_data_updated';

// Empty default fallback arrays (NO client-side mock data)
export const INITIAL_DEFAULT_RECORDS: AdminBusinessRecord[] = [];
export const INITIAL_DEFAULT_BATCHES: ImportBatch[] = [];
export const INITIAL_DEFAULT_DUPLICATES: DuplicatePair[] = [];

// API Interaction Helper Functions - Fetching and updating Neon PostgreSQL directly
export async function fetchAdminRecordsFromApi(): Promise<AdminBusinessRecord[]> {
  try {
    const res = await fetch('/api/v1/admin/businesses', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    if (json && Array.isArray(json.data)) {
      return json.data;
    }
  } catch (err) {
    console.warn('[Admin Data Store] Failed to fetch admin records from API:', err);
  }
  return [];
}

export async function saveAdminRecordStatusToApi(records: AdminBusinessRecord[]): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/admin/businesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businesses: records }),
    });
    return res.ok;
  } catch (err) {
    console.warn('[Admin Data Store] Failed to save admin record status to API:', err);
    return false;
  }
}

export async function fetchImportBatchesFromApi(): Promise<ImportBatch[]> {
  try {
    const res = await fetch('/api/v1/admin/import/batches', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    if (json && Array.isArray(json.data)) {
      return json.data;
    }
  } catch (err) {
    console.warn('[Admin Data Store] Failed to fetch import batches from API:', err);
  }
  return [];
}

export async function fetchDuplicatePairsFromApi(): Promise<DuplicatePair[]> {
  try {
    const res = await fetch('/api/v1/admin/duplicates', { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    if (json && Array.isArray(json.data)) {
      return json.data;
    }
  } catch (err) {
    console.warn('[Admin Data Store] Failed to fetch duplicate pairs from API:', err);
  }
  return [];
}

// Deprecated local storage wrappers kept for backwards compatibility but now routing to API or returning empty arrays
export function loadAdminRecordsFromStorage(): AdminBusinessRecord[] {
  return [];
}

export function saveAdminRecordsToStorage(records: AdminBusinessRecord[]) {
  saveAdminRecordStatusToApi(records);
}

export function loadImportBatchesFromStorage(): ImportBatch[] {
  return [];
}

export function saveImportBatchesToStorage(batches: ImportBatch[]) {}

export function loadDuplicatePairsFromStorage(): DuplicatePair[] {
  return [];
}

export function saveDuplicatePairsToStorage(duplicates: DuplicatePair[]) {}
