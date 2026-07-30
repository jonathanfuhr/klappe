import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/auth.decorators';
import { DB, type Database } from '../db/db.module';

@Controller()
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Wird vom Healthcheck in docker-compose abgefragt. */
  @Public()
  @Get('healthz')
  async health(): Promise<{ status: string; database: 'up' | 'down' }> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
