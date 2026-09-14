import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client } from 'typesense';
import { TYPESENSE_CLIENT } from './typesense.constants';

@Injectable()
export class TypesenseService {
  private readonly logger = new Logger(TypesenseService.name);

  constructor(
    @Inject(TYPESENSE_CLIENT)
    private readonly client: Client,
  ) {}

  getClient(): Client {
    return this.client;
  }

  async ping(): Promise<boolean> {
    if (!this.client) {
      return true;
    }
    try {
      const health: any = await (this.client as any).health?.retrieve?.() ?? await this.client.collections().retrieve();
      return health !== null && health !== undefined;
    } catch (error) {
      this.logger.error('Typesense health check failed', error);
      return false;
    }
  }

  async getCollections() {
    return this.client.collections().retrieve();
  }
}
