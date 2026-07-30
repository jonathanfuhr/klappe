/**
 * Migrationen einspielen. Wird beim Containerstart vor der API ausgeführt
 * (siehe `docker/entrypoint.sh`) und kann lokal mit `npm run migrate` laufen.
 */
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { loadConfig } from '../config/configuration';

const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });

  try {
    await waitForDatabase(pool);
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[migrate] Schema ist aktuell.');
  } finally {
    await pool.end();
  }
}

/** Postgres braucht im Compose-Start ein paar Sekunden länger als die API. */
async function waitForDatabase(pool: Pool, attempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.log(`[migrate] Warte auf Postgres (Versuch ${attempt}/${attempts}) …`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

main().catch((error: unknown) => {
  console.error('[migrate] Fehlgeschlagen:', error);
  process.exit(1);
});
