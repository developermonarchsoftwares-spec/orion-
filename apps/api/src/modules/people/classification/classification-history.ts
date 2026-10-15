import * as schema from '../../../database/schema';
import type { DrizzleDb } from '../../../database/database.provider';
import type { IRoleClassification } from './role-classifier';
import { UNVERSIONED } from './taxonomies';

type Tx = Pick<DrizzleDb, 'insert'>;

export interface IClassificationValues {
  normalizedTitle: string;
  seniorityLevel: string;
  department: string;
  decisionMakerType: string | null;
  relationshipType?: string | null;
}

/**
 * Records what a taxonomy version decided for a role. Idempotent: the same role, taxonomy version and normalised title is
 * stored once, so re-ingesting the same title under the same version never adds a row. Returns true when a row was added.
 */
export async function recordSystemClassification(tx: Tx, companyPersonId: string, c: IRoleClassification): Promise<boolean> {
  const rows = await tx
    .insert(schema.companyPeopleClassifications)
    .values({
      companyPersonId,
      kind: 'SYSTEM_CLASSIFICATION',
      taxonomyVersion: c.taxonomyVersion,
      normalizedTitle: c.normalizedTitle,
      seniorityLevel: c.seniorityLevel,
      department: c.department,
      decisionMakerType: c.decisionMakerType,
      relationshipType: c.relationshipType,
      ruleId: c.ruleId,
      ruleTrace: c.ruleTrace,
      strength: c.strength,
      actorKind: 'SYSTEM',
    })
    .onConflictDoNothing()
    .returning({ id: schema.companyPeopleClassifications.id });
  return rows.length > 0;
}

/**
 * Snapshots a role's pre-versioning (legacy) classification as a SYSTEM_CLASSIFICATION row labelled "unversioned", so the value
 * a reviewer is about to override is not lost. Only used when the role has no system history at all.
 */
export async function snapshotLegacyClassification(tx: Tx, companyPersonId: string, v: IClassificationValues, version: string | null): Promise<void> {
  await tx
    .insert(schema.companyPeopleClassifications)
    .values({
      companyPersonId,
      kind: 'SYSTEM_CLASSIFICATION',
      taxonomyVersion: version ?? UNVERSIONED,
      normalizedTitle: v.normalizedTitle,
      seniorityLevel: v.seniorityLevel,
      department: v.department,
      decisionMakerType: v.decisionMakerType,
      relationshipType: v.relationshipType ?? null,
      actorKind: 'SYSTEM',
    })
    .onConflictDoNothing();
}

/** Records a reviewer's decision. Never replaces or edits the system result it overrides. */
export async function recordReviewerOverride(
  tx: Tx,
  companyPersonId: string,
  v: IClassificationValues,
  actor: { id: string | null; label: string | null },
): Promise<void> {
  await tx.insert(schema.companyPeopleClassifications).values({
    companyPersonId,
    kind: 'REVIEWER_OVERRIDE',
    taxonomyVersion: null,
    normalizedTitle: v.normalizedTitle,
    seniorityLevel: v.seniorityLevel,
    department: v.department,
    decisionMakerType: v.decisionMakerType,
    relationshipType: v.relationshipType ?? null,
    actorKind: 'REVIEWER',
    actorId: actor.id,
    actorLabel: actor.label?.slice(0, 255) ?? null,
  });
}
