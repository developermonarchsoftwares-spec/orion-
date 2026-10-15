import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BusinessException } from '../../common/errors/business.exception';
import { detectConflicts } from './conflicts/conflict-detector';
import { recordSystemClassification } from './classification/classification-history';
import { RoleClassificationService } from './classification/role-classification.service';
import {
  IPeopleIngestionPort,
  IPersonUpsertInput,
  IPersonUpsertResult,
} from './contracts/people-ingestion.contract';
import type { PersonDataStatus, VerificationStatus } from './people.constants';
import {
  clampScore,
  evidenceFingerprint,
  normalizeSourceLocator,
  isGenericMailbox,
  isValidEmail,
  isValidPhone,
  namesCompatible,
  normalizeContactValue,
  normalizeLinkedinUrl,
  normalizePersonName,
  splitPersonName,
} from './people.utils';
import { laterDate } from './people-rollup';
import { expireStoredExports } from '../../common/privacy/stored-exports';
import { findSuppressionMatch, identityOfUpsert, lockPerson, registerSuppressedIdentities, suppressionDigest } from './suppression/people-suppression';
import { ATTESTED_ROLE_CLAIMS, evidenceStrength } from './policies/claim-verification.policy';
import { reconcileContact, reconcileRole, recordSystemAttestation } from './verification/verification-state';

type PersonRow = typeof schema.people.$inferSelect;
type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];

const later = laterDate;

const sha = evidenceFingerprint;

/**
 * Write side of the People layer and the single place that touches the people tables.
 * Used by PeopleIngestionService (Phase 2) and, later, the upload pipeline through
 * IPeopleIngestionPort. Not reachable from any customer HTTP endpoint.
 *
 * Guarantees: idempotent (re-running the same input creates nothing new), never downgrades
 * stronger stored data with weaker input, never merges identities on a name alone, never makes
 * anything customer-visible unless the caller explicitly passes dataStatus: 'PUBLISHED'.
 */
@Injectable()
export class PeopleWriteService implements IPeopleIngestionPort {
  private readonly logger = new Logger(PeopleWriteService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    @Optional() private readonly classifier: RoleClassificationService = new RoleClassificationService(),
  ) {}

  async upsertPersonForBusiness(input: IPersonUpsertInput): Promise<IPersonUpsertResult> {
    const fullName = input.person.fullName?.trim();
    const jobTitle = input.role.jobTitle?.trim();
    if (!fullName) throw new BusinessException('Person name is required', 'PERSON_NAME_REQUIRED', HttpStatus.BAD_REQUEST);
    if (!jobTitle) throw new BusinessException('Job title is required', 'JOB_TITLE_REQUIRED', HttpStatus.BAD_REQUEST);

    const classification = this.classifier.classify(jobTitle);
    const normalizedName = normalizePersonName(fullName);
    const linkedinNorm = normalizeLinkedinUrl(input.person.linkedinUrl);
    const now = new Date();
    const warnings: string[] = [];

    const contacts = (input.contacts ?? []).filter((c) => {
      const ok =
        c.type === 'WORK_EMAIL' ? isValidEmail(c.value) && !isGenericMailbox(c.value) : isValidPhone(c.value);
      if (!ok) warnings.push(`CONTACT_REJECTED:${c.type}`);
      return ok;
    });

    return this.db.transaction(async (tx) => {
      let changed = false;

      const business = await tx.query.businesses.findFirst({
        where: eq(schema.businesses.id, input.businessId),
        columns: { id: true },
      });
      if (!business) throw new BusinessException('Business not found', 'BUSINESS_NOT_FOUND', HttpStatus.NOT_FOUND);

      // ---------------------------------------------------------------- suppression registry (Phase 6.4)
      // A record carrying a deterministic identity signal of a suppressed person never creates or updates anything, whichever
      // source, source record id, title or company it comes with. Checked inside this transaction.
      const suppressed = await findSuppressionMatch(tx, { ...identityOfUpsert({ person: input.person, contacts }), normalizedName });
      if (suppressed) {
        throw new BusinessException('This person has been suppressed and cannot be re-ingested', 'SUPPRESSED_PERSON', HttpStatus.CONFLICT, {
          suppression: { kind: suppressed.kind, personId: suppressed.personId },
        });
      }

      // ---------------------------------------------------------------- identity
      const resolution = await this.resolvePerson(tx, {
        businessId: input.businessId,
        normalizedName,
        linkedinNorm,
        jobNorm: classification.normalizedTitle,
        contacts: contacts.map((c) => ({ type: c.type, norm: normalizeContactValue(c.type, c.value) })),
      });
      warnings.push(...resolution.warnings);
      if (resolution.person) {
        // Serialise with a concurrent suppression of this same person, then look at the state as it is NOW.
        await lockPerson(tx, resolution.person.id);
        const [fresh] = await tx.select({ s: schema.people.dataStatus }).from(schema.people).where(eq(schema.people.id, resolution.person.id));
        if (fresh?.s === 'SUPPRESSED') {
          throw new BusinessException('This person has been suppressed and cannot be re-ingested', 'SUPPRESSED_PERSON', HttpStatus.CONFLICT, {
            suppression: { kind: 'PERSON', personId: resolution.person.id },
          });
        }
      }

      let personId: string;
      let personCreated = false;
      if (resolution.person) {
        const p = resolution.person;
        personId = p.id;
        const fills = {
          linkedinUrl: !p.linkedinUrl && input.person.linkedinUrl && linkedinNorm ? input.person.linkedinUrl : null,
          linkedinNorm: !p.normalizedLinkedinUrl ? linkedinNorm : null,
          photoUrl: !p.photoUrl ? (input.person.photoUrl ?? null) : null,
          city: !p.city ? (input.person.city ?? null) : null,
          state: !p.state ? (input.person.state ?? null) : null,
          country: !p.country ? (input.person.country ?? null) : null,
        };
        const publish = input.dataStatus === 'PUBLISHED' && p.dataStatus !== 'PUBLISHED';
        if (Object.values(fills).some(Boolean) || publish) changed = true;
        // Fill gaps only; never overwrite existing data with weaker input.
        await tx
          .update(schema.people)
          .set({
            ...(fills.linkedinUrl ? { linkedinUrl: fills.linkedinUrl } : {}),
            ...(fills.linkedinNorm ? { normalizedLinkedinUrl: fills.linkedinNorm } : {}),
            ...(fills.photoUrl ? { photoUrl: fills.photoUrl } : {}),
            ...(fills.city ? { city: fills.city } : {}),
            ...(fills.state ? { state: fills.state } : {}),
            ...(fills.country ? { country: fills.country } : {}),
            ...(publish ? { dataStatus: 'PUBLISHED' } : {}),
            lastSeenAt: now,
            updatedAt: now,
          })
          .where(eq(schema.people.id, p.id));
      } else {
        const names = splitPersonName(fullName);
        const [created] = await tx
          .insert(schema.people)
          .values({
            ...names,
            fullName,
            normalizedName,
            linkedinUrl: linkedinNorm ? (input.person.linkedinUrl ?? null) : null,
            normalizedLinkedinUrl: linkedinNorm,
            photoUrl: input.person.photoUrl ?? null,
            city: input.person.city ?? null,
            state: input.person.state ?? null,
            country: input.person.country ?? null,
            dataStatus: input.dataStatus ?? 'DRAFT',
          })
          .returning({ id: schema.people.id });
        personId = created.id;
        personCreated = true;
        changed = true;
      }

      // ---------------------------------------------------------------- role (company_people)
      // A relationship is (company, person). Its current title is the unique key, but a title a
      // reviewer replaced stays in title_aliases so the original wording resolves to the same role.
      const existingRole =
        (await tx.query.companyPeople.findFirst({
          where: and(
            eq(schema.companyPeople.businessId, input.businessId),
            eq(schema.companyPeople.personId, personId),
            eq(schema.companyPeople.normalizedJobTitle, classification.normalizedTitle),
          ),
        })) ??
        (await tx.query.companyPeople.findFirst({
          where: and(
            eq(schema.companyPeople.businessId, input.businessId),
            eq(schema.companyPeople.personId, personId),
            sql`${classification.normalizedTitle} = ANY(${schema.companyPeople.titleAliases})`,
          ),
        }));

      // Only role-scoped evidence can back a role's verification claim.
      const roleEvidenceInput = (input.evidence ?? []).filter((e) => e.scope === undefined || e.scope === 'ROLE');
      let backed = roleEvidenceInput.some((e) => !!e.verifiedAt);
      if (!backed && existingRole) {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.peopleEvidence)
          .where(
            and(
              eq(schema.peopleEvidence.companyPersonId, existingRole.id),
              sql`${schema.peopleEvidence.verifiedAt} IS NOT NULL`,
            ),
          );
        backed = (row?.n ?? 0) > 0;
      }

      // Verification claimed by the source. It is NOT written to the status columns here: it becomes a SYSTEM
      // attestation in the verification ledger (below) and the columns are derived from the ledger, so a re-upload
      // can neither downgrade a ledger-backed verification nor clear a dispute.
      let requested = input.verificationStatus;
      if ((requested === 'VERIFIED' || requested === 'PARTIALLY_VERIFIED') && !backed) {
        this.logger.warn(`Claimed ${requested} for person ${personId} without verified evidence; not applied`);
        warnings.push('VERIFICATION_CLAIM_WITHOUT_EVIDENCE');
        requested = 'UNVERIFIED';
      }
      if (requested === 'STALE') {
        warnings.push('STALE_INPUT_IGNORED'); // staleness is computed from the verification date, never asserted by input
        requested = undefined;
      }

      const lastVerifiedAt = later(
        existingRole?.lastVerifiedAt,
        input.lastVerifiedAt,
        ...roleEvidenceInput.map((e) => e.verifiedAt),
      );
      const confidenceScore = Math.max(existingRole?.confidenceScore ?? 0, clampScore(input.confidenceScore));
      const isCurrent = input.role.isCurrent ?? existingRole?.isCurrent ?? true;
      const isPublished = input.dataStatus === 'PUBLISHED' ? true : (existingRole?.isPublished ?? false);
      const relationshipType = input.role.relationshipType ?? existingRole?.relationshipType ?? classification.relationshipType;
      const startDate = input.role.startDate ?? existingRole?.startDate ?? null;
      const endDate = input.role.endDate ?? existingRole?.endDate ?? null;

      let companyPersonId: string;
      let roleCreated = false;
      if (existingRole) {
        // The role's own title decides its classification: a title reached through an alias must not reclassify a retitled role.
        const roleClassification =
          existingRole.normalizedJobTitle === classification.normalizedTitle ? classification : this.classifier.classify(existingRole.normalizedJobTitle);
        // A reviewer's classification is stronger than the automatic one and survives re-ingestion. So does the classification
        // of an approved / published role: a newer taxonomy version adds a history row but never changes what customers see.
        const reviewerOwnsClassification = existingRole.classificationSource === 'REVIEWER';
        const approvedRole = existingRole.isPublished || existingRole.reviewStatus === 'APPROVED';
        const holdsEffective = reviewerOwnsClassification || approvedRole;
        const sameAsStored =
          existingRole.department === roleClassification.department &&
          existingRole.seniorityLevel === roleClassification.seniorityLevel &&
          existingRole.decisionMakerType === roleClassification.decisionMakerType;
        const department = holdsEffective ? existingRole.department : roleClassification.department;
        const seniorityLevel = holdsEffective ? existingRole.seniorityLevel : roleClassification.seniorityLevel;
        const decisionMakerType = holdsEffective ? existingRole.decisionMakerType : roleClassification.decisionMakerType;
        // Version stamp of the AUTO classification in force: applied when the role takes the new result, or when an approved
        // role's existing values are identical to it (a pure label, no change in meaning). Never touched for reviewer overrides.
        const stampVersion = !reviewerOwnsClassification && (!approvedRole || sameAsStored);
        const versionChanged = stampVersion && existingRole.classificationVersion !== roleClassification.taxonomyVersion;
        // Only the legacy trusted-caller switch can publish here; ingestion never does.
        const publishNow = isPublished && !existingRole.isPublished;
        const roleChanged =
          existingRole.confidenceScore !== confidenceScore ||
          existingRole.isCurrent !== isCurrent ||
          existingRole.isPublished !== isPublished ||
          existingRole.relationshipType !== relationshipType ||
          existingRole.startDate !== startDate ||
          existingRole.endDate !== endDate ||
          existingRole.decisionMakerType !== decisionMakerType ||
          existingRole.department !== department ||
          existingRole.seniorityLevel !== seniorityLevel ||
          (existingRole.lastVerifiedAt?.getTime() ?? 0) !== (lastVerifiedAt?.getTime() ?? 0);
        if (roleChanged) changed = true;
        await tx
          .update(schema.companyPeople)
          .set({
            relationshipType,
            department,
            seniorityLevel,
            decisionMakerType,
            ...(stampVersion
              ? {
                  classificationVersion: roleClassification.taxonomyVersion,
                  classificationStrength: roleClassification.strength,
                  ...(versionChanged || existingRole.classifiedAt === null ? { classifiedAt: now } : {}),
                }
              : {}),
            isCurrent,
            isPublished,
            // keeps the DB invariant (published => APPROVED); never changes review state otherwise
            ...(publishNow ? { reviewStatus: 'APPROVED' } : {}),
            startDate,
            endDate,
            confidenceScore,
            lastVerifiedAt,
            // monotonic: a slower concurrent writer can never move last-seen backwards
            lastSeenAt: sql`GREATEST(${schema.companyPeople.lastSeenAt}, ${now}::timestamptz)`,
            updatedAt: now,
          })
          .where(eq(schema.companyPeople.id, existingRole.id));
        companyPersonId = existingRole.id;
        // Idempotent: the same role + taxonomy version + title adds nothing (re-ingestion of an unchanged title).
        await recordSystemClassification(tx, existingRole.id, roleClassification);
      } else {
        const [created] = await tx
          .insert(schema.companyPeople)
          .values({
            businessId: input.businessId,
            personId,
            normalizedJobTitle: classification.normalizedTitle,
            jobTitleAtCompany: jobTitle, // first-seen wording is kept
            relationshipType,
            department: classification.department,
            seniorityLevel: classification.seniorityLevel,
            decisionMakerType: classification.decisionMakerType,
            classificationVersion: classification.taxonomyVersion,
            classificationStrength: classification.strength,
            classifiedAt: now,
            isCurrent,
            isPublished,
            reviewStatus: isPublished ? 'APPROVED' : 'PENDING',
            startDate,
            endDate,
            confidenceScore,
            lastVerifiedAt,
          })
          .returning({ id: schema.companyPeople.id });
        companyPersonId = created.id;
        await recordSystemClassification(tx, created.id, classification);
        roleCreated = true;
        changed = true;
      }

      // ---------------------------------------------------------------- contacts
      let contactsCreated = 0;
      const contactRuns: Array<{ id: string; type: 'WORK_EMAIL' | 'PHONE' | 'MOBILE'; norm: string; claimed: VerificationStatus; hasDate: boolean }> = [];
      for (const c of contacts) {
        const norm = normalizeContactValue(c.type, c.value);
        if (resolution.blockedContacts.has(`${c.type}:${norm}`)) {
          warnings.push(`CONTACT_BELONGS_TO_ANOTHER_PERSON:${c.type}`);
          continue;
        }
        const claimed = c.verificationStatus ?? 'UNVERIFIED';

        const [existing] = await tx
          .select()
          .from(schema.personContacts)
          .where(
            and(
              eq(schema.personContacts.personId, personId),
              eq(schema.personContacts.contactType, c.type),
              eq(schema.personContacts.normalizedValue, norm),
            ),
          );

        if (!existing) {
          const [inserted] = await tx
            .insert(schema.personContacts)
            .values({
              personId,
              contactType: c.type,
              contactValue: c.value.trim(),
              normalizedValue: norm,
              isPrimary: c.isPrimary ?? false,
              isPublished: c.isPublished ?? false,
              confidenceScore: clampScore(c.confidenceScore),
              sourceType: c.sourceType ?? null,
              lastVerifiedAt: c.lastVerifiedAt ?? null,
              lastSeenAt: now,
            })
            .returning({ id: schema.personContacts.id });
          contactsCreated++;
          changed = true;
          contactRuns.push({ id: inserted.id, type: c.type, norm, claimed, hasDate: !!c.lastVerifiedAt });
          if (c.isPrimary) {
            await tx
              .update(schema.personContacts)
              .set({ isPrimary: false })
              .where(
                and(
                  eq(schema.personContacts.personId, personId),
                  eq(schema.personContacts.contactType, c.type),
                  ne(schema.personContacts.id, inserted.id),
                ),
              );
          }
        } else {
          contactRuns.push({ id: existing.id, type: c.type, norm, claimed, hasDate: !!c.lastVerifiedAt });
          const nextVerified = later(existing.lastVerifiedAt, c.lastVerifiedAt);
          const nextConfidence = Math.max(existing.confidenceScore, clampScore(c.confidenceScore));
          const nextPublished = c.isPublished === true ? true : existing.isPublished;
          const nextPrimary = c.isPrimary === true ? true : existing.isPrimary;
          const nextSource = existing.sourceType ?? c.sourceType ?? null;
          // Freshness: THIS contact claim was seen again (only the contacts actually present in the record are touched).
          // Monotonic and independent of the 'changed' flag: seeing a claim again is not a change to it.
          await tx
            .update(schema.personContacts)
            .set({ lastSeenAt: sql`GREATEST(${schema.personContacts.lastSeenAt}, ${now}::timestamptz)` })
            .where(eq(schema.personContacts.id, existing.id));
          if (
            (nextVerified?.getTime() ?? 0) !== (existing.lastVerifiedAt?.getTime() ?? 0) ||
            nextConfidence !== existing.confidenceScore ||
            nextPublished !== existing.isPublished ||
            nextPrimary !== existing.isPrimary ||
            nextSource !== existing.sourceType
          ) {
            changed = true;
            await tx
              .update(schema.personContacts)
              .set({
                lastVerifiedAt: nextVerified,
                confidenceScore: nextConfidence,
                isPublished: nextPublished,
                isPrimary: nextPrimary,
                sourceType: nextSource,
                updatedAt: now,
              })
              .where(eq(schema.personContacts.id, existing.id));
          }
          if (c.isPrimary && !existing.isPrimary) {
            await tx
              .update(schema.personContacts)
              .set({ isPrimary: false })
              .where(
                and(
                  eq(schema.personContacts.personId, personId),
                  eq(schema.personContacts.contactType, c.type),
                  ne(schema.personContacts.id, existing.id),
                ),
              );
          }
        }
      }

      // ---------------------------------------------------------------- evidence (idempotent by fingerprint)
      let evidenceCreated = 0;
      const claimEvidence = new Map<string, string>(); // 'C:<contactId>' | 'P' -> the evidence row this record produced or re-confirmed (provenance link)
      let primaryEvidenceId: string | null = null; // the role-scoped evidence this record produced or re-confirmed (for the observation link)
      for (const e of input.evidence ?? []) {
        let contactId: string | null = null;
        if (e.scope === 'CONTACT') {
          if (!e.contact) {
            throw new BusinessException('CONTACT evidence needs a contact', 'EVIDENCE_CONTACT_REQUIRED', HttpStatus.BAD_REQUEST);
          }
          const [target] = await tx
            .select({ id: schema.personContacts.id })
            .from(schema.personContacts)
            .where(
              and(
                eq(schema.personContacts.personId, personId),
                eq(schema.personContacts.contactType, e.contact.type),
                eq(schema.personContacts.normalizedValue, normalizeContactValue(e.contact.type, e.contact.value)),
              ),
            );
          if (!target) {
            warnings.push('EVIDENCE_SKIPPED_CONTACT_NOT_STORED');
            continue;
          }
          contactId = target.id;
        }
        const roleScoped = e.scope === undefined || e.scope === 'ROLE';
        const targetKey = contactId ? `C:${contactId}` : roleScoped ? `R:${companyPersonId}` : `P:${personId}`;
        const fingerprint = sha([
          personId,
          targetKey,
          e.sourceType,
          e.evidenceType,
          normalizeSourceLocator(e.sourceUrl, e.sourceReference),
        ]);

        const [existing] = await tx
          .select()
          .from(schema.peopleEvidence)
          .where(eq(schema.peopleEvidence.fingerprint, fingerprint));
        if (existing) {
          // Re-observation of the same source: keep the strongest facts, never lose provenance.
          const observedAt = later(existing.observedAt, e.observedAt) ?? existing.observedAt;
          const verifiedAt = later(existing.verifiedAt, e.verifiedAt);
          if (roleScoped && !contactId && !primaryEvidenceId) primaryEvidenceId = existing.id;
          if (contactId) claimEvidence.set(`C:${contactId}`, existing.id);
          else if (!roleScoped && e.evidenceType === 'IDENTITY_CLAIM') claimEvidence.set('P', existing.id);
          const confidence = Math.max(existing.confidenceScore, clampScore(e.confidenceScore));
          if (
            observedAt.getTime() !== existing.observedAt.getTime() ||
            (verifiedAt?.getTime() ?? 0) !== (existing.verifiedAt?.getTime() ?? 0) ||
            confidence !== existing.confidenceScore
          ) {
            changed = true;
            await tx
              .update(schema.peopleEvidence)
              .set({ observedAt, verifiedAt, confidenceScore: confidence })
              .where(eq(schema.peopleEvidence.id, existing.id));
          }
          continue;
        }
        const inserted = await tx
          .insert(schema.peopleEvidence)
          .values({
            personId,
            contactId,
            companyPersonId: roleScoped && !contactId ? companyPersonId : null,
            fingerprint,
            sourceType: e.sourceType,
            evidenceType: e.evidenceType,
            sourceUrl: e.sourceUrl ?? null,
            sourceReference: e.sourceReference ?? null,
            observedAt: e.observedAt ?? now,
            verifiedAt: e.verifiedAt ?? null,
            confidenceScore: clampScore(e.confidenceScore),
          })
          .onConflictDoNothing()
          .returning({ id: schema.peopleEvidence.id });
        if (inserted.length) {
          evidenceCreated++;
          changed = true;
          if (roleScoped && !contactId && !primaryEvidenceId) primaryEvidenceId = inserted[0].id;
          if (contactId) claimEvidence.set(`C:${contactId}`, inserted[0].id);
          else if (!roleScoped && e.evidenceType === 'IDENTITY_CLAIM') claimEvidence.set('P', inserted[0].id);
        } else if (contactId || (!roleScoped && e.evidenceType === 'IDENTITY_CLAIM')) {
          // a concurrent writer created the same evidence: link to that row
          const [raced] = await tx.select({ id: schema.peopleEvidence.id }).from(schema.peopleEvidence).where(eq(schema.peopleEvidence.fingerprint, fingerprint));
          if (raced) claimEvidence.set(contactId ? `C:${contactId}` : 'P', raced.id);
        }
      }

      // ---------------------------------------------------------------- person-level rollup
      // ---------------------------------------------------------------- verification ledger (system attestations)
      // Only verification the SOURCE attested with verified evidence is recorded, and only as a SYSTEM event
      // (never a reviewer). Existing decisions for the same claim always win.
      const roleBefore = existingRole?.verificationStatus ?? 'UNVERIFIED';
      const verifiedRoleEvidence = (
        await tx
          .select()
          .from(schema.peopleEvidence)
          .where(and(eq(schema.peopleEvidence.companyPersonId, companyPersonId), sql`${schema.peopleEvidence.verifiedAt} IS NOT NULL`))
          .orderBy(sql`${schema.peopleEvidence.verifiedAt} DESC`)
          .limit(1)
      )[0];
      const roleClaimValue = { TITLE: classification.normalizedTitle, RELATIONSHIP: input.businessId } as const;
      if ((requested === 'VERIFIED' || requested === 'PARTIALLY_VERIFIED') && verifiedRoleEvidence) {
        for (const claim of ATTESTED_ROLE_CLAIMS[requested]) {
          const wrote = await recordSystemAttestation(tx, {
            claim,
            personId,
            roleId: companyPersonId,
            // the stored (possibly reviewer-edited) title is the role's identity; attest what is stored
            value: claim === 'TITLE' ? (existingRole?.normalizedJobTitle ?? classification.normalizedTitle) : roleClaimValue.RELATIONSHIP,
            status: 'VERIFIED',
            evidence: { id: verifiedRoleEvidence.id, sourceType: verifiedRoleEvidence.sourceType },
            attestedBy: verifiedRoleEvidence.sourceType,
            verifiedAt: verifiedRoleEvidence.verifiedAt!,
            strength: evidenceStrength(verifiedRoleEvidence.evidenceType),
            note: `Attested by the ingestion source (${verifiedRoleEvidence.sourceType}) with evidence verified at ${verifiedRoleEvidence.verifiedAt!.toISOString()}; no reviewer involved`,
          });
          if (wrote === 'RECORDED') changed = true;
        }
      } else if (requested === 'CONFLICTED') {
        for (const claim of ['TITLE', 'RELATIONSHIP'] as const) {
          const wrote = await recordSystemAttestation(tx, {
            claim,
            personId,
            roleId: companyPersonId,
            value: claim === 'TITLE' ? (existingRole?.normalizedJobTitle ?? classification.normalizedTitle) : roleClaimValue.RELATIONSHIP,
            status: 'DISPUTED',
            evidence: null,
            attestedBy: 'INGESTION_SOURCE',
            verifiedAt: now,
            note: 'The ingestion source reported this role as conflicted',
          });
          if (wrote === 'RECORDED' || wrote === 'UPDATED') changed = true;
          if (wrote === 'BLOCKED_BY_REVIEWER') warnings.push(`CONFLICT_REPORT_IGNORED_REVIEWER_DECISION:${claim}`);
        }
      }
      const roleRec = await reconcileRole(tx, companyPersonId, now);
      const storedStatus: VerificationStatus = roleRec?.after ?? roleBefore;
      if (roleRec && roleRec.after !== roleRec.before) changed = true;

      for (const run of contactRuns) {
        const claim = run.type === 'WORK_EMAIL' ? ('EMAIL' as const) : ('PHONE' as const);
        if (run.claimed === 'VERIFIED' && run.hasDate) {
          const [cev] = await tx
            .select()
            .from(schema.peopleEvidence)
            .where(and(eq(schema.peopleEvidence.contactId, run.id), sql`${schema.peopleEvidence.verifiedAt} IS NOT NULL`))
            .orderBy(sql`${schema.peopleEvidence.verifiedAt} DESC`)
            .limit(1);
          if (cev) {
            const wrote = await recordSystemAttestation(tx, {
              claim,
              personId,
              contactId: run.id,
              value: run.norm,
              status: 'VERIFIED',
              evidence: { id: cev.id, sourceType: cev.sourceType },
              attestedBy: cev.sourceType,
              verifiedAt: cev.verifiedAt!,
              strength: evidenceStrength(cev.evidenceType),
              note: `Attested by the ingestion source (${cev.sourceType}) with evidence verified at ${cev.verifiedAt!.toISOString()}; no reviewer involved`,
            });
            if (wrote === 'RECORDED') changed = true;
          } else {
            warnings.push(`CONTACT_VERIFICATION_WITHOUT_EVIDENCE:${run.type}`);
          }
        } else if (run.claimed === 'PARTIALLY_VERIFIED') {
          warnings.push(`CONTACT_PARTIAL_VERIFICATION_NOT_RECORDED:${run.type}`);
        } else if (run.claimed === 'CONFLICTED') {
          const wrote = await recordSystemAttestation(tx, {
            claim,
            personId,
            contactId: run.id,
            value: run.norm,
            status: 'DISPUTED',
            evidence: null,
            attestedBy: 'INGESTION_SOURCE',
            verifiedAt: now,
            note: 'The ingestion source reported this contact as conflicted',
          });
          if (wrote === 'RECORDED' || wrote === 'UPDATED') changed = true;
          if (wrote === 'BLOCKED_BY_REVIEWER') warnings.push(`CONFLICT_REPORT_IGNORED_REVIEWER_DECISION:${run.type}`);
        }
        const rec = await reconcileContact(tx, run.id, now);
        if (rec && rec.after !== rec.before) changed = true;
      }


      // ---------------------------------------------------------------- observation (same transaction: atomic with the write)
      let observation: IPersonUpsertResult['observation'];
      if (input.observation) {
        const o = input.observation;
        const rows = await tx
          .insert(schema.peopleObservations)
          .values({
            sourceKey: o.sourceKey,
            sourceVersion: o.sourceVersion,
            sourceRecordId: o.sourceRecordId,
            batchRef: o.batchRef,
            acquiredAt: o.acquiredAt,
            observedAt: o.observedAt,
            contentFingerprint: o.contentFingerprint,
            outcome: 'INGESTED',
            personId,
            companyPersonId,
            businessId: input.businessId,
            evidenceId: primaryEvidenceId,
            observedName: fullName.slice(0, 200),
            observedTitle: jobTitle.slice(0, 200),
            normalizedTitle: classification.normalizedTitle.slice(0, 200),
            classificationVersion: classification.taxonomyVersion,
            observedIsCurrent: input.role.isCurrent ?? null,
            payloadBytes: o.payloadBytes,
            payloadRef: o.payloadRef ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: schema.peopleObservations.id });
        observation = { id: rows[0]?.id ?? null, recorded: rows.length > 0, duplicate: rows.length === 0 };
        // Contact provenance: which contact points THIS observation claimed (digests only; links to the canonical contact and
        // its evidence). A duplicate observation already has its claims. Never touches verification.
        if (rows.length > 0) {
          const claims: Array<typeof schema.peopleObservationClaims.$inferInsert> = contactRuns.map((r) => ({
            observationId: rows[0].id,
            claimType: r.type,
            contactId: r.id,
            valueDigest: suppressionDigest(r.norm),
            evidenceId: claimEvidence.get(`C:${r.id}`) ?? null,
          }));
          if (linkedinNorm) {
            claims.push({ observationId: rows[0].id, claimType: 'LINKEDIN', contactId: null, valueDigest: suppressionDigest(linkedinNorm), evidenceId: claimEvidence.get('P') ?? null });
          }
          if (claims.length) await tx.insert(schema.peopleObservationClaims).values(claims).onConflictDoNothing();
        }
      }

      // ---------------------------------------------------------------- conflict detection (Phase 6.8)
      // Records disagreements between claims for review. Picks no winner; changes no verification, publication or suppression.
      await detectConflicts(tx, {
        personId,
        businessId: input.businessId,
        companyPersonId,
        normalizedName,
        linkedinNorm,
        contacts: contacts.map((c) => ({ type: c.type, norm: normalizeContactValue(c.type, c.value) })),
        observationId: observation?.id ?? null,
        now,
      });

      return {
        personId,
        companyPersonId,
        personCreated,
        roleCreated,
        contactsCreated,
        evidenceCreated,
        storedVerificationStatus: storedStatus,
        unchanged: !changed,
        warnings,
        observation,
      };
    });
  }

  /**
   * Deterministic identity resolution. Priority: LinkedIn > work email (non-generic, compatible
   * name) > phone + identical name > identical name at the same company. Names alone never merge
   * people across companies, and any ambiguity throws rather than guessing.
   */
  private async resolvePerson(
    tx: Tx,
    a: {
      businessId: string;
      normalizedName: string;
      linkedinNorm: string | null;
      jobNorm: string;
      contacts: Array<{ type: 'WORK_EMAIL' | 'PHONE' | 'MOBILE'; norm: string }>;
    },
  ): Promise<{ person: PersonRow | null; warnings: string[]; blockedContacts: Set<string> }> {
    const warnings: string[] = [];
    const blockedContacts = new Set<string>();
    const linkedinDiffers = (p: PersonRow) =>
      !!a.linkedinNorm && !!p.normalizedLinkedinUrl && p.normalizedLinkedinUrl !== a.linkedinNorm;
    /** Current name or an earlier spelling that a reviewer corrected. */
    const hasName = (p: PersonRow) => p.normalizedName === a.normalizedName || (p.nameAliases ?? []).includes(a.normalizedName);

    const owners = async (type: 'WORK_EMAIL' | 'PHONE' | 'MOBILE', norm: string) =>
      tx
        .select({ person: schema.people })
        .from(schema.personContacts)
        .innerJoin(schema.people, eq(schema.people.id, schema.personContacts.personId))
        .where(and(eq(schema.personContacts.contactType, type), eq(schema.personContacts.normalizedValue, norm)))
        .then((rows) => rows.map((r) => r.person));

    let chosen: PersonRow | null = null;
    if (a.linkedinNorm) {
      chosen = (await tx.query.people.findFirst({ where: eq(schema.people.normalizedLinkedinUrl, a.linkedinNorm) })) ?? null;
    }

    // Work email is unique to one person: an email owned by someone we do not resolve to is not ours to attach.
    const emailCandidates = new Map<string, PersonRow>();
    for (const c of a.contacts.filter((x) => x.type === 'WORK_EMAIL')) {
      for (const p of await owners('WORK_EMAIL', c.norm)) {
        if (chosen?.id === p.id) continue;
        emailCandidates.set(p.id, p);
        blockedContacts.add(`WORK_EMAIL:${c.norm}`);
      }
    }

    if (chosen) {
      if (emailCandidates.size) warnings.push('IDENTITY_CONFLICT:EMAIL_OWNED_BY_OTHER_PERSON');
    } else {
      const compatible = [...emailCandidates.values()].filter(
        (p) =>
          [p.normalizedName, ...(p.nameAliases ?? [])].some((n) => namesCompatible(n, a.normalizedName)) &&
          !linkedinDiffers(p),
      );
      if (compatible.length > 1) {
        throw new BusinessException('Contact matches several existing people', 'AMBIGUOUS_IDENTITY', HttpStatus.CONFLICT);
      }
      if (compatible.length === 1) {
        chosen = compatible[0];
        for (const c of a.contacts.filter((x) => x.type === 'WORK_EMAIL')) {
          const ownedBy = await owners('WORK_EMAIL', c.norm);
          if (ownedBy.every((p) => p.id === chosen!.id)) blockedContacts.delete(`WORK_EMAIL:${c.norm}`);
        }
      }
    }

    if (!chosen) {
      const phoneMatches = new Map<string, PersonRow>();
      for (const c of a.contacts.filter((x) => x.type !== 'WORK_EMAIL')) {
        for (const p of await owners(c.type, c.norm)) {
          if (hasName(p) && !linkedinDiffers(p)) phoneMatches.set(p.id, p);
        }
      }
      if (phoneMatches.size > 1) {
        throw new BusinessException('Phone matches several existing people', 'AMBIGUOUS_IDENTITY', HttpStatus.CONFLICT);
      }
      if (phoneMatches.size === 1) chosen = [...phoneMatches.values()][0];
    }

    if (!chosen) {
      const sameName = await tx
        .select({ person: schema.people, title: schema.companyPeople.normalizedJobTitle })
        .from(schema.people)
        .innerJoin(schema.companyPeople, eq(schema.companyPeople.personId, schema.people.id))
        .where(
          and(
            sql`(${schema.people.normalizedName} = ${a.normalizedName} OR ${a.normalizedName} = ANY(${schema.people.nameAliases}))`,
            eq(schema.companyPeople.businessId, a.businessId),
          ),
        );
      const people = new Map<string, PersonRow>();
      for (const r of sameName) if (!linkedinDiffers(r.person)) people.set(r.person.id, r.person);
      if (people.size === 1) chosen = [...people.values()][0];
      else if (people.size > 1) {
        // Several same-named people here: only the one already holding this exact role is unambiguous.
        const holders = new Set(sameName.filter((r) => r.title === a.jobNorm && people.has(r.person.id)).map((r) => r.person.id));
        if (holders.size !== 1) {
          throw new BusinessException(
            'Several people with this name exist at this company; a LinkedIn URL or work email is needed',
            'AMBIGUOUS_IDENTITY',
            HttpStatus.CONFLICT,
          );
        }
        chosen = people.get([...holders][0])!;
      }
    }

    if (chosen?.dataStatus === 'SUPPRESSED') {
      throw new BusinessException('This person has been suppressed and cannot be re-ingested', 'SUPPRESSED_PERSON', HttpStatus.CONFLICT, {
        suppression: { kind: 'PERSON', personId: chosen.id },
      });
    }
    return { person: chosen, warnings, blockedContacts };
  }

  async setDataStatus(personId: string, status: PersonDataStatus): Promise<void> {
    await this.db.transaction(async (tx) => {
      await lockPerson(tx, personId);
      await tx
        .update(schema.people)
        .set({ dataStatus: status, updatedAt: new Date() })
        .where(eq(schema.people.id, personId));
      if (status === 'SUPPRESSED') {
        // A suppressed person must not leave any published role behind ...
        await tx
          .update(schema.companyPeople)
          .set({ isPublished: false, updatedAt: new Date() })
          .where(eq(schema.companyPeople.personId, personId));
        // ... and (Phase 6.4) must not be suppressed without the durable registry entries, in the same transaction.
        await expireStoredExports(tx);
        await registerSuppressedIdentities(tx, personId, { origin: 'LEGACY_SET_STATUS', byKind: 'SYSTEM', byLabel: 'system:set-data-status' });
      }
    });
  }
}
