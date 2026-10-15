import { Injectable } from '@nestjs/common';
import { classifyWithTaxonomy, IRoleClassification } from './role-classifier';
import { CURRENT_TAXONOMY_VERSION, currentTaxonomy, getTaxonomy } from './taxonomies';
import type { ITaxonomy } from './taxonomy.types';

/**
 * The classification boundary of the People layer. Given a title it returns a versioned, explainable classification; that is all.
 * It never publishes, verifies, suppresses, creates companies, fetches data or writes anything: callers persist the result.
 * Stateless apart from the taxonomy it was built with (the current one unless a test supplies another).
 */
@Injectable()
export class RoleClassificationService {
  private taxonomy: ITaxonomy = currentTaxonomy();

  /** A service pinned to an explicit taxonomy (tests simulate a newer version this way). */
  static withTaxonomy(taxonomy: ITaxonomy): RoleClassificationService {
    const s = new RoleClassificationService();
    s.taxonomy = taxonomy;
    return s;
  }

  get version(): string {
    return this.taxonomy.version;
  }

  static get currentVersion(): string {
    return CURRENT_TAXONOMY_VERSION;
  }

  classify(rawTitle: string | null | undefined): IRoleClassification {
    return classifyWithTaxonomy(rawTitle, this.taxonomy);
  }

  /** Re-runs a title under a specific, registered version: reproduces what that version said, whatever is current now. */
  replay(rawTitle: string | null | undefined, version: string): IRoleClassification {
    return classifyWithTaxonomy(rawTitle, getTaxonomy(version));
  }
}
