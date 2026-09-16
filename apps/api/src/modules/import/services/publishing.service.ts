import { Injectable, Logger } from '@nestjs/common';
import { PublishQueueRepository } from '../repositories/duplicate-review.repositories';
import { ImportRecordRepository } from '../repositories/import.repositories';
import { BusinessService, ICreateBusinessAggregateInput } from '../../business/services/business.service';
import { QueueService } from '../../queue/queue.service';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { INormalizedRecordResult } from './normalization.service';

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly publishRepo: PublishQueueRepository,
    private readonly recordRepo: ImportRecordRepository,
    private readonly businessService: BusinessService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Publishes an approved record into the 3NF business database and triggers search indexing
   */
  async publishRecord(publishQueueId: string) {
    const publishItems = await this.publishRepo.findPendingToPublish(10);
    const item = publishItems.find((p) => p.id === publishQueueId);

    if (!item || !item.record) {
      throw new Error(`Publish queue item '${publishQueueId}' is invalid or missing record`);
    }

    await this.publishRepo.updateStatus(item.id, 'PROCESSING');

    try {
      const payload = (item.record.normalizedPayload || item.record.rawPayload) as unknown as INormalizedRecordResult;

      const aggregateInput: ICreateBusinessAggregateInput = {
        name: payload.name,
        legalName: payload.legalName,
        status: 'PUBLISHED',
        description: payload.description,
        foundingYear: payload.foundingYear,
        locations: payload.locations?.map((loc) => ({
          addressLine1: loc.addressLine1,
          addressLine2: loc.addressLine2,
          city: loc.city,
          district: loc.district,
          state: loc.state,
          pincode: loc.pincode,
          country: loc.country,
        })),
        contacts: payload.contacts?.map((c) => ({
          fullName: c.fullName,
          title: c.title,
          email: c.email,
          phone: c.phone,
          isPrimary: c.isPrimary,
        })),
        digitalPresences: payload.digitalPresences?.map((d) => ({
           
          platform: d.platform as any,
          url: d.url,
          domain: d.domain,
        })),
        identifiers: payload.identifiers?.map((i) => ({
          type: i.type,
          value: i.value,
        })),
      };

      // 1. Create 3NF Business Entity
      const publishedBusiness = await this.businessService.createBusinessAggregate(aggregateInput);

      // 2. Mark record & publish item as PUBLISHED
      await this.publishRepo.updateStatus(item.id, 'PUBLISHED', publishedBusiness.id);
      await this.recordRepo.updateStatus(item.record.id, 'PUBLISHED');

      // 3. Trigger Search Synchronization Queue
      await this.queueService.addJob(QUEUE_NAMES.TYPESENSE_SYNC, 'index-business', {
        businessId: publishedBusiness.id,
        action: 'UPSERT',
      });

      this.logger.log(
        `Successfully published business: ${publishedBusiness.name} (ID: ${publishedBusiness.id}) -> Search index enqueued`,
      );

      return publishedBusiness;
    } catch (error) {
      this.logger.error(`Publish failed for queue item ${publishQueueId}: ${(error as Error).message}`, (error as Error).stack);
      await this.publishRepo.updateStatus(item.id, 'FAILED', undefined, (error as Error).message);
      throw error;
    }
  }
}
