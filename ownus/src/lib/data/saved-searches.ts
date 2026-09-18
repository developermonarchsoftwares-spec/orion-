import type { SavedSearch } from '@/lib/types';
 
// Saved searches in Orion.
// In production, saved searches are fetched from and persisted in PostgreSQL via /api/v1/saved-searches.
export const savedSearches: SavedSearch[] = [];
