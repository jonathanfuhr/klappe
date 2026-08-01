import { type Locale, DEFAULT_LOCALE, isLocale, resolveLocale } from '@klappe/shared';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { DB, type Database } from '../db/db.module';
import { appSettings } from '../db/schema';

/** Die eine Zeile in `app_settings` – dieselbe ID wie im Branding-Dienst. */
const SETTINGS_ID = 1;

/** So lange gilt die gemerkte Workspace-Sprache, bevor neu nachgesehen wird. */
const CACHE_MS = 30_000;

/**
 * In welcher Sprache antwortet die API? (Phase 26)
 *
 * Die Reihenfolge ist dieselbe wie in der Oberfläche: die eigene Wahl unter
 * „Profil und Sicherheit", sonst die Vorgabe des Workspace, sonst der Browser,
 * sonst Deutsch. Damit steht eine Fehlermeldung in derselben Sprache wie die
 * Seite, auf der sie erscheint.
 *
 * Die Workspace-Vorgabe wird kurz gemerkt: Sie wird an jeder abgewiesenen
 * Anfrage gebraucht, ändert sich aber höchstens einmal im Jahr. Eine
 * Datenbankabfrage je Fehler wäre dafür zu teuer – eine halbe Minute alter
 * Stand schadet niemandem.
 */
@Injectable()
export class LocaleService {
  private gemerkt: { wert: Locale; bis: number } | null = null;

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Die Vorgabe des Workspace. */
  async workspaceLocale(): Promise<Locale> {
    const jetzt = Date.now();
    if (this.gemerkt && this.gemerkt.bis > jetzt) return this.gemerkt.wert;

    try {
      const [row] = await this.db
        .select({ defaultLocale: appSettings.defaultLocale })
        .from(appSettings)
        .where(eq(appSettings.id, SETTINGS_ID))
        .limit(1);
      const wert = isLocale(row?.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE;
      this.gemerkt = { wert, bis: jetzt + CACHE_MS };
      return wert;
    } catch {
      // Steht die Datenbank nicht bereit, ist eine Fehlermeldung auf Deutsch
      // immer noch besser als gar keine.
      return DEFAULT_LOCALE;
    }
  }

  /** Vergisst den gemerkten Stand – nach einer Änderung der Einstellung. */
  vergessen(): void {
    this.gemerkt = null;
  }

  /**
   * Die Sprache eines bekannten Kontos: erst dessen eigene Wahl, sonst die
   * Vorgabe des Workspace. Ohne den Browser-Schritt – der passt nur, solange
   * jemand davorsitzt, und gilt deshalb für Mails nicht.
   */
  async forUser(eigene: string | null | undefined): Promise<Locale> {
    return isLocale(eigene) ? eigene : await this.workspaceLocale();
  }

  /**
   * Die Sprache des Anfragenden. `request.user` steht erst hinter dem Guard;
   * bei einer abgewiesenen Anmeldung bleibt der Browser-Wunsch übrig.
   */
  async forRequest(request: Request): Promise<Locale> {
    const eigene = (request as { user?: { locale?: Locale | null } }).user?.locale ?? null;
    return resolveLocale(eigene, await this.workspaceLocale(), request.headers['accept-language']);
  }
}
