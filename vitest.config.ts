import { defineConfig } from 'vitest/config';

/**
 * Ein Testlauf über das ganze Monorepo. Getestet wird bewusst die reine
 * Logik – Timecode-Mathematik, Upload-Protokoll, ffprobe-Auswertung,
 * Passwort-Hashing –, also genau die Stellen, an denen ein Fehler still
 * bleibt und erst im Schnittraum auffällt.
 */
export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    reporters: ['default'],
  },
});
