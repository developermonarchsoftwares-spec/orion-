import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DATABASE } from '../../database/database.constants';
import { DrizzleDb } from '../../database/database.provider';
import * as schema from '../../database/schema';
import { WebhookEvent } from './integration.constants';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

/**
 * The one call the rest of the application makes: `emit(userId, event, data)`. It queues the event for each of that user's ACTIVE
 * webhooks that subscribed to it. It never throws and never waits for the receiver, so a slow or broken endpoint cannot slow down or
 * fail the action that produced the event. `data` should carry ids and counts, not personal data.
 */
@Injectable()
export class IntegrationEventsService {
  private readonly logger = new Logger(IntegrationEventsService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: DrizzleDb,
    private readonly dispatcher: WebhookDispatcherService,
  ) {}

  async emit(userId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
    try {
      const hooks = await this.db
        .select()
        .from(schema.integrations)
        .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.type, 'WEBHOOK'), eq(schema.integrations.status, 'ACTIVE')));
      let queued = 0;
      for (const h of hooks) {
        if (!(h.events as string[]).includes(event)) continue;
        await this.dispatcher.enqueue(h, event, data);
        queued++;
      }
      return queued;
    } catch (err) {
      this.logger.warn(`Could not queue ${event} for ${userId}: ${(err as Error).message}`);
      return 0;
    }
  }
}
