import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { BusinessException } from '../../common/errors/business.exception';
import { AuditLogService } from '../../common/services/audit-log.service';
import { CreditService } from '../credit/credit.service';
import { PERSON_UNLOCK_COST_CREDITS } from './people.constants';
import { lockPerson } from './suppression/people-suppression';
import { contactsForAnyCompany, loadContactAttribution } from './people-contact-attribution';
import { CUSTOMER_VISIBLE_ROLE, PeopleService } from './people.service';
import { IntegrationEventsService } from '../integrations/integration-events.service';

/**
 * Reveals a person's published contact points. Reuses the platform wallet
 * (CreditService.deductCredits, UNLOCK_LEAD ledger type) - there is no second credit system.
 * Contact values are stripped server-side in PeopleService until a person_unlocks row exists.
 */
@Injectable()
export class PeopleUnlockService {
  private readonly logger = new Logger(PeopleUnlockService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly creditService: CreditService,
    private readonly peopleService: PeopleService,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() private readonly events?: IntegrationEventsService,
  ) {}

  async unlockPerson(userId: string, personId: string) {
    const roles = await this.peopleService.loadPublishedRolesForPerson(personId);
    if (roles.length === 0) {
      throw new BusinessException('Person not found', 'PERSON_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const existing = await this.findUnlock(userId, personId);
    if (existing) return this.alreadyUnlocked(userId, personId);

    // Never charge for a person with nothing to reveal (contacts that no visible company relationship may show do not count).
    const n = await this.revealableContactCount(this.db, personId, roles.map((r) => r.role.businessId));
    const hasLinkedin = !!roles[0].person.linkedinUrl;
    if (n === 0 && !hasLinkedin) {
      throw new BusinessException(
        'No contact information is available for this person yet',
        'NO_CONTACT_AVAILABLE',
        HttpStatus.CONFLICT,
      );
    }

    const cost = PERSON_UNLOCK_COST_CREDITS;
    const fullName = roles[0].person.fullName;

    try {
      const result = await this.db.transaction(async (tx) => {
        // Serialise with a concurrent suppression / publication change of THIS person, then with a concurrent unlock of the same
        // (customer, person): the second request waits here, sees the first unlock below and is never charged. (Without this the
        // second request would deduct, then fail on the unique index and roll back: correct in the end, but only by accident.)
        await lockPerson(tx, personId);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`people:unlock:${userId}:${personId}`}))`);

        const [again] = await tx
          .select({ id: schema.personUnlocks.id })
          .from(schema.personUnlocks)
          .where(and(eq(schema.personUnlocks.userId, userId), eq(schema.personUnlocks.personId, personId)));
        if (again) return { already: true as const };

        // Visibility is re-checked NOW, inside the locked transaction (the check above can be stale): a person who became hidden,
        // rejected or suppressed in the meantime cannot be newly unlocked, and nothing is charged.
        const visibleRoles = await tx
          .select({ businessId: schema.companyPeople.businessId })
          .from(schema.companyPeople)
          .innerJoin(schema.people, eq(schema.people.id, schema.companyPeople.personId))
          .innerJoin(schema.businesses, eq(schema.businesses.id, schema.companyPeople.businessId))
          .where(and(eq(schema.people.id, personId), ...CUSTOMER_VISIBLE_ROLE(), eq(schema.businesses.status, 'PUBLISHED')));
        if (visibleRoles.length === 0) throw new BusinessException('Person not found', 'PERSON_NOT_FOUND', HttpStatus.NOT_FOUND);
        const contactsNow = await this.revealableContactCount(tx, personId, visibleRoles.map((r) => r.businessId));
        const [stillLinkedin] = await tx.select({ l: schema.people.linkedinUrl }).from(schema.people).where(eq(schema.people.id, personId));
        if (contactsNow === 0 && !stillLinkedin?.l) {
          throw new BusinessException('No contact information is available for this person yet', 'NO_CONTACT_AVAILABLE', HttpStatus.CONFLICT);
        }

        const deduction = await this.creditService.deductCredits(
          userId,
          cost,
          `Unlocked contact: ${fullName}`,
          personId,
          'UNLOCK_LEAD',
          tx,
        );
        await tx.insert(schema.personUnlocks).values({ userId, personId, creditsSpent: cost });
        return { already: false as const, wallet: deduction.wallet };
      });

      if (result.already) return this.alreadyUnlocked(userId, personId);

      await this.auditLogService?.record({
        userId,
        action: 'PERSON_UNLOCKED',
        entityType: 'PERSON',
        entityId: personId,
        newValues: { creditsSpent: cost },
      });
      this.logger.log(`User ${userId} unlocked person ${personId} for ${cost} credit(s)`);
      void this.creditService.notifyIfLow(userId);
      void this.events?.emit(userId, 'person.unlocked', { personId, creditsSpent: cost, balance: result.wallet?.balance ?? null });

      return {
        success: true,
        alreadyUnlocked: false,
        message: 'Contact unlocked successfully',
        creditsSpent: cost,
        balance: result.wallet.balance,
        dailyCredits: result.wallet.dailyCredits,
        purchasedCredits: result.wallet.purchasedCredits,
        person: await this.personAfterUnlock(personId, userId),
      };
    } catch (err: any) {
      // A concurrent request won the race; the failed transaction rolled back our deduction.
      if (err?.code === '23505' || err?.cause?.code === '23505') return this.alreadyUnlocked(userId, personId);
      throw err;
    }
  }

  /**
   * The unlock is already committed when this runs. If the person became hidden in the meantime the customer must not get a
   * confusing error for a charge that really happened: the response still says success and simply carries no profile.
   */
  private async personAfterUnlock(personId: string, userId: string) {
    try {
      return await this.peopleService.getPersonDetail(personId, userId);
    } catch (err) {
      this.logger.warn(`Unlocked person ${personId} is no longer visible: ${(err as Error).message}`);
      return null;
    }
  }

  async getUnlockedPeople(userId: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [[{ total }], rows] = await Promise.all([
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.personUnlocks)
        .where(eq(schema.personUnlocks.userId, userId)),
      this.db
        .select()
        .from(schema.personUnlocks)
        .where(eq(schema.personUnlocks.userId, userId))
        .orderBy(desc(schema.personUnlocks.unlockedAt), desc(schema.personUnlocks.id))
        .limit(limit)
        .offset(offset),
    ]);

    const details = [];
    for (const r of rows) {
      const roles = await this.peopleService.loadPublishedRolesForPerson(r.personId);
      if (roles.length === 0) continue; // suppressed / unpublished since unlock: no longer visible
      const cards = await this.peopleService.buildCards(roles, userId);
      details.push({ unlockedAt: r.unlockedAt, creditsSpent: r.creditsSpent, roles: cards });
    }
    return { unlocked: details, pagination: { page, limit, totalItems: total, totalPages: Math.ceil(total / limit) || 1 } };
  }

  /** Published contacts of the person that at least one of the given visible companies may show (same rule as every customer card). */
  private async revealableContactCount(q: Pick<DrizzleDb, 'select'>, personId: string, visibleBusinessIds: string[]): Promise<number> {
    const published = await q
      .select({ id: schema.personContacts.id, personId: schema.personContacts.personId })
      .from(schema.personContacts)
      .where(and(eq(schema.personContacts.personId, personId), eq(schema.personContacts.isPublished, true)));
    if (published.length === 0) return 0;
    const attribution = await loadContactAttribution(q, [personId]);
    return contactsForAnyCompany(published, visibleBusinessIds, attribution).length;
  }

  private async findUnlock(userId: string, personId: string) {
    const [row] = await this.db
      .select()
      .from(schema.personUnlocks)
      .where(and(eq(schema.personUnlocks.userId, userId), eq(schema.personUnlocks.personId, personId)))
      .limit(1);
    return row ?? null;
  }

  private async alreadyUnlocked(userId: string, personId: string) {
    const wallet = await this.creditService.getWallet(userId);
    return {
      success: true,
      alreadyUnlocked: true,
      message: 'Contact is already unlocked in your account',
      creditsSpent: 0,
      balance: wallet.balance,
      person: await this.peopleService.getPersonDetail(personId, userId),
    };
  }
}
