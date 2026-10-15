/**
 * Publication guard for the gateway's admin status screen (risk R-005).
 *
 * The API refuses to publish a business whose recorded source has not been approved (Phase 15). The gateway's status screen used to run
 * `UPDATE businesses SET status = ...` directly, so an administrator could publish around that rule; the database trigger only stops a
 * REVOKED source. These helpers add the same rule to the gateway's two UPDATE statements:
 *   - moving a business to PUBLISHED is refused when it has a recorded source whose trust status is not APPROVED;
 *   - a business with no recorded source is unaffected (older records), and every other status change is unaffected;
 *   - the API's explicit override flag is NOT available here: an administrator who needs to publish from an unreviewed source uses the API.
 */

export type StatusKey = 'id' | 'slug';

const GUARD = `($3::boolean = false OR source_id IS NULL OR EXISTS (SELECT 1 FROM data_sources ds WHERE ds.id = businesses.source_id AND ds.trust_status = 'APPROVED'))`;

/** Parameters: $1 new status, $2 id or slug, $3 whether the new status is PUBLISHED. Returns the id of the row that changed, if any. */
export function statusUpdateSql(key: StatusKey): string {
  const column = key === 'id' ? 'id' : 'slug';
  return `UPDATE businesses SET status = $1, updated_at = NOW() WHERE ${column} = $2 AND ${GUARD} RETURNING id`;
}

/** Parameters: $1 id or slug. True rows mean "this business has a source that is not approved". Used only to explain a refusal. */
export function refusedLookupSql(key: StatusKey): string {
  const column = key === 'id' ? 'b.id' : 'b.slug';
  return `SELECT 1 FROM businesses b JOIN data_sources s ON s.id = b.source_id WHERE ${column} = $1 AND s.trust_status <> 'APPROVED' LIMIT 1`;
}

export const isPublishStatus = (dbStatus: string): boolean => dbStatus === 'PUBLISHED';

export const PUBLISH_REFUSED_REASON = 'The business source is not approved. Approve the source, or publish through the import review (API) with the override.';
