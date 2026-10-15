import { createHash } from 'crypto';
import type { ITaxonomy } from '../taxonomy.types';
import { TAXONOMY_V1 } from './v1';

/**
 * Registry of every taxonomy version that has ever classified a role. Versions are only ever ADDED: a version that has produced
 * stored results stays here, unchanged, so any historical classification can be explained and replayed.
 */
export const TAXONOMIES: Readonly<Record<string, ITaxonomy>> = Object.freeze({ v1: TAXONOMY_V1 });

/** The version used for new automatic classifications. Move it only together with a new, registered taxonomy file. */
export const CURRENT_TAXONOMY_VERSION = 'v1';

/** Marks a stored classification that predates versioning (no version was recorded; nothing is back-filled). */
export const UNVERSIONED = 'unversioned';

export const KNOWN_TAXONOMY_VERSIONS: readonly string[] = Object.freeze(Object.keys(TAXONOMIES));

export function getTaxonomy(version: string): ITaxonomy {
  const t = TAXONOMIES[version];
  if (!t) throw new Error(`Unknown role taxonomy version "${version}"`);
  return t;
}

export function currentTaxonomy(): ITaxonomy {
  return getTaxonomy(CURRENT_TAXONOMY_VERSION);
}

/** Stable content fingerprint of a taxonomy (version, every rule id, pattern, replacement, order). Used to prove immutability. */
export function taxonomyFingerprint(t: ITaxonomy): string {
  const canon = JSON.stringify(t, (_k, v) => (v instanceof RegExp ? `re:${v.source}/${v.flags}` : v));
  return createHash('sha256').update(canon).digest('hex');
}
