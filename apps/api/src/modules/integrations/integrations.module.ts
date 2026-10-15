import { Global, Module } from '@nestjs/common';
import { CrmSyncService } from './crm/crm-sync.service';
import { HubSpotClient } from './crm/hubspot.client';
import { IntegrationCallbackController } from './integration-callback.controller';
import { IntegrationEventsService } from './integration-events.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

/** Global so any service can `emit` an event without importing this module (the injection is optional, so tests that omit it still work). */
@Global()
@Module({
  controllers: [IntegrationCallbackController, IntegrationsController],
  providers: [IntegrationsService, WebhookDispatcherService, IntegrationEventsService, HubSpotClient, CrmSyncService],
  exports: [IntegrationEventsService, IntegrationsService],
})
export class IntegrationsModule {}
