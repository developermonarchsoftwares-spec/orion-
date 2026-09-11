import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { DRIZZLE_DATABASE, PG_POOL } from './database.constants';

export type DrizzleDb = NodePgDatabase<typeof schema>;

export const databaseProviders: Provider[] = [
  {
    provide: PG_POOL,
    inject: [ConfigService],
    useFactory: (configService: ConfigService): Pool => {
      const databaseUrl = configService.get<string>('database.url');
      const maxConnections = configService.get<number>('database.maxConnections', 20);
      const idleTimeoutMillis = configService.get<number>('database.idleTimeoutMs', 30000);

      const pool = new Pool({
        connectionString: databaseUrl,
        max: maxConnections,
        idleTimeoutMillis,
        connectionTimeoutMillis: 5000,
      });

      pool.on('error', (err) => {
        // Log unexpected error on idle client
        console.error('Unexpected error on idle PostgreSQL client', err);
      });

      return pool;
    },
  },
  {
    provide: DRIZZLE_DATABASE,
    inject: [PG_POOL],
    useFactory: (pool: Pool): DrizzleDb => {
      return drizzle(pool, { schema, logger: process.env.NODE_ENV === 'development' });
    },
  },
];
