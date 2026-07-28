import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://klappe:klappe@localhost:5432/klappe',
  },
  casing: 'snake_case',
} satisfies Config;
