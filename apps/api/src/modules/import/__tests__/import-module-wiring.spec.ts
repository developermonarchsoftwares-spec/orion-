import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DRIZZLE_DATABASE } from '../../../database/database.constants';
import { TransactionService } from '../../../database/transaction.service';
import { PEOPLE_INGESTION_SERVICE } from '../../people/ingestion/ingestion.types';
import { createTestDb } from '../../people/__tests__/pglite-test-db';
import { QueueService } from '../../queue/queue.service';
import { ImportModule } from '../import.module';
import { ImportPeopleBridge } from '../people/import-people.bridge';
import { PublishingService } from '../services/publishing.service';

/**
 * The REAL ImportModule (with the real PeopleModule import) must resolve in Nest's DI.
 * Only infrastructure is stubbed: database, queue, config.
 */
describe('ImportModule wiring', () => {
  it('resolves, and the publishing stage is connected to the People ingestion service by token', async () => {
    const t = await createTestDb();

    @Global()
    @Module({
      providers: [
        { provide: DRIZZLE_DATABASE, useValue: t.db },
        TransactionService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: QueueService, useValue: { addJob: jest.fn(), registerWorker: jest.fn(), createWorker: jest.fn(), unregisterWorker: jest.fn() } },
      ],
      exports: [DRIZZLE_DATABASE, TransactionService, ConfigService, QueueService],
    })
    class InfraStub {}

    try {
      const module = await Test.createTestingModule({ imports: [InfraStub, ImportModule] }).compile();
      const bridge = module.get(ImportPeopleBridge);
      expect(bridge).toBeDefined();
      expect((bridge as any).people).toBe(module.get(PEOPLE_INGESTION_SERVICE, { strict: false }));
      expect((module.get(PublishingService) as any).peopleBridge).toBe(bridge);
      await module.close();
    } finally {
      await t.client.close();
    }
  });
});
