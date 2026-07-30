import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { NodePgDatabase, drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig, CONFIG } from '../config/configuration';
import * as schema from './schema';

export const DB = 'KLAPPE_DB';
export const PG_POOL = 'KLAPPE_PG_POOL';

export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({
          connectionString: config.databaseUrl,
          max: 10,
          // Transcoding-Jobs halten Verbindungen sonst unnötig lange.
          idleTimeoutMillis: 30_000,
        }),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
