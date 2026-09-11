import { Provider, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'typesense';
import { TYPESENSE_CLIENT } from './typesense.constants';

export const typesenseProviders: Provider[] = [
  {
    provide: TYPESENSE_CLIENT,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): Client => {
      const logger = new Logger('TypesenseProvider');
      const nodes = configService.get<Array<{ host: string; port: number; protocol: string }>>(
        'typesense.nodes',
        [{ host: 'localhost', port: 8108, protocol: 'http' }],
      );
      const apiKey = configService.get<string>(
        'typesense.apiKey',
        'xyz123_orion_typesense_master_key',
      );
      const connectionTimeoutSeconds = configService.get<number>(
        'typesense.connectionTimeoutSeconds',
        5,
      );

      const client = new Client({
        nodes,
        apiKey,
        connectionTimeoutSeconds,
      });

      logger.log(
        `Typesense client initialized with nodes: ${nodes.map((n) => `${n.protocol}://${n.host}:${n.port}`).join(', ')}`,
      );

      return client;
    },
  },
];
