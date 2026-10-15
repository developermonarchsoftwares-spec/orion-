import * as schema from '../../src/database/schema';

/**
 * Phase 15: an import publishes automatically only when its batch names an APPROVED source and asks for it. The older end-to-end suites test what
 * happens after publication, so they register an approved source and send its id. The refusal rules are tested in provenance-publishing.e2e-spec.ts.
 */
export async function createApprovedSource(db: { insert: (t: unknown) => any }, name = 'E2E approved source'): Promise<string> {
  const [row] = await db.insert(schema.dataSources).values({ name: `${name} ${Math.random().toString(36).slice(2, 8)}`, type: 'MANUAL_IMPORT', trustStatus: 'APPROVED' }).returning({ id: schema.dataSources.id });
  return row.id as string;
}
