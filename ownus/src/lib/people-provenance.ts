/**
 * View model of the People Review dossier's "Import provenance" section (internal reviewers only).
 * Pure: it only reshapes what GET /internal/people-review/roles/:id returned in `provenance`; it never invents a value.
 */

export interface IProvenanceObservation {
  source: { key: string; name: string; version: string };
  batchRef: string;
  sourceRecordId: string;
  acquiredAt: string | null;
  observedAt: string | null;
  observedTitle: string | null;
  observedIsCurrent: boolean | null;
}

export interface IProvenance {
  available: boolean;
  truncated: boolean;
  observations: IProvenanceObservation[];
}

export interface IProvenanceRow {
  key: string;
  source: string;
  batchRef: string;
  sourceRecord: string;
  acquired: string;
  observed: string;
  reportedTitle: string | null;
  reportedCurrent: string | null;
}

export interface IProvenanceView {
  empty: boolean;
  /** Shown when there is nothing to show. */
  emptyMessage: string;
  heading: string;
  rows: IProvenanceRow[];
  /** Set when the dossier holds more observations than it lists. */
  moreNote: string | null;
}

export const NO_PROVENANCE_MESSAGE = 'No import provenance available. This role has no recorded import (added by hand, or imported before imports were recorded).';
const NOT_STATED = 'not stated by the source';

const when = (iso: string | null | undefined, fallback: string): string => {
  if (!iso) return fallback;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? fallback : t.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

export function buildProvenanceView(p: IProvenance | null | undefined): IProvenanceView {
  const observations = p?.available ? p.observations ?? [] : [];
  if (observations.length === 0) return { empty: true, emptyMessage: NO_PROVENANCE_MESSAGE, heading: 'Import provenance', rows: [], moreNote: null };
  return {
    empty: false,
    emptyMessage: '',
    heading: observations.length === 1 ? 'Import provenance' : `Import provenance (${observations.length}${p?.truncated ? '+' : ''} observations, newest first)`,
    rows: observations.map((o, i) => ({
      key: `${o.source.key}:${o.batchRef}:${o.sourceRecordId}:${i}`,
      source: o.source.name === o.source.key ? o.source.name : `${o.source.name} (${o.source.key})`,
      batchRef: o.batchRef || 'not recorded',
      sourceRecord: o.sourceRecordId || 'not recorded',
      acquired: when(o.acquiredAt, 'not recorded'),
      observed: when(o.observedAt, NOT_STATED),
      reportedTitle: o.observedTitle,
      reportedCurrent: o.observedIsCurrent === null || o.observedIsCurrent === undefined ? null : o.observedIsCurrent ? 'current' : 'former',
    })),
    moreNote: p?.truncated ? 'Older observations are not listed.' : null,
  };
}
