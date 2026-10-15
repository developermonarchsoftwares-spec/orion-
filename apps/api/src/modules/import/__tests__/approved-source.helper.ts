import * as schema from '../../../database/schema';
import { DrizzleDb } from '../../../database/database.provider';
import { AdminImportService } from '../services/admin-import.service';

/**
 * Test harness for the older import suites (Phase 15). Since Phase 15 an import does not publish unless its batch names an APPROVED source
 * and asks for automatic publication, and an administrator's publish needs an actor. These suites test what happens AFTER publication, so
 * their harness stands in for "an approved source with automatic publication" and "an administrator who confirms". The rules themselves
 * (unapproved, unnamed, restricted and revoked sources, direct calls, workers) are tested in provenance-publishing.integration.spec.ts.
 */
export async function withApprovedSource(admin: AdminImportService, db: DrizzleDb) {
  const [src] = await db.insert(schema.dataSources).values({ name: `Test approved source ${Math.random().toString(36).slice(2, 8)}`, type: 'MANUAL_IMPORT', trustStatus: 'APPROVED' }).returning();
  const [user] = await db
    .insert(schema.users)
    .values({ email: `publisher.${Math.random().toString(36).slice(2, 10)}@orion.test`, firstName: 'Pub', lastName: 'Lisher', role: 'ADMIN', status: 'ACTIVE' } as never)
    .returning({ id: schema.users.id });
  const submit = admin.submitBatch.bind(admin);
  const publish = admin.publishBatch.bind(admin);
  admin.submitBatch = ((p: Parameters<typeof submit>[0]) => submit({ autoPublish: true, sourceId: src.id, ...p })) as typeof admin.submitBatch;
  admin.publishBatch = ((id: string, actor?: { id: string }, opts?: { allowUnreviewedSource?: boolean }) => publish(id, actor ?? { id: user.id }, opts ?? { allowUnreviewedSource: true })) as typeof admin.publishBatch;
  return { sourceId: src.id, adminId: user.id };
}

/** The admin service as the older suites use it: publishBatch with just a batch id. */
export type TestAdminImport = Omit<AdminImportService, 'publishBatch'> & {
  publishBatch(id: string, actor?: { id: string }, opts?: { allowUnreviewedSource?: boolean }): ReturnType<AdminImportService['publishBatch']>;
};
