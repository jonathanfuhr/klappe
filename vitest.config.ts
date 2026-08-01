import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Ein Testlauf über das ganze Monorepo. Getestet wird bewusst die reine
 * Logik – Timecode-Mathematik, Upload-Protokoll, ffprobe-Auswertung,
 * Passwort-Hashing –, also genau die Stellen, an denen ein Fehler still
 * bleibt und erst im Schnittraum auffällt.
 */
export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      // Auch im Web gibt es Logik ohne Bildschirm – etwa welche Bezeichnung
      // eine KI-Art trägt. Nur `.test.ts`, keine Komponenten: Ein Testlauf
      // ohne DOM bleibt schnell und braucht keine zweite Umgebung.
      'apps/web/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    reporters: ['default'],
  },
  resolve: {
    // `@/…` ist im Web-Paket der Verweis auf `src` (siehe apps/web/tsconfig.json).
    // Vitest liest dessen Pfad-Zuordnung nicht mit, deshalb hier noch einmal.
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
});
