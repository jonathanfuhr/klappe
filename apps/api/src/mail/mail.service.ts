import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { deriveBrandColors, normalizeBrandTitle } from '@klappe/shared';
import type { Locale, NotificationAudience, NotificationKind } from '@klappe/shared';
import { desc, eq, sql } from 'drizzle-orm';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { mailFailures } from '../db/schema';
import type { MailFailureDto } from '@klappe/shared';
import { LocaleService } from '../i18n/locale.service';
import { NotificationSettingsService } from '../settings/notification-settings.service';
import { SettingsService, type SmtpCredentials } from '../settings/settings.service';
import { Ms365OauthService } from './ms365-oauth.service';
import { createUnsubscribeToken } from './unsubscribe-token';
import { DEFAULT_MAIL_BRAND, type MailBrand, type RenderedMail, renderTestMail } from './templates';

/**
 * Wozu eine Mail gehört und wen sie erreicht (Phase 28). Beides zusammen
 * beantwortet die Frage, ob der Admin sie zugelassen hat.
 */
export interface MailAbsicht {
  kind: NotificationKind;
  audience: NotificationAudience;
}

/**
 * Versand über generisches SMTP (Nodemailer), wie im Konzept entschieden.
 *
 * Die Verbindung wird zwischengehalten und erst dann neu aufgebaut, wenn der
 * Admin die Einstellungen ändert – erkennbar an einem Abgleich der Werte.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private transporterKey = '';

  constructor(
    private readonly settingsService: SettingsService,
    private readonly notificationSettings: NotificationSettingsService,
    private readonly ms365Oauth: Ms365OauthService,
    private readonly locales: LocaleService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  async isReady(): Promise<boolean> {
    return this.settingsService.isMailReady();
  }

  /**
   * Verschickt eine fertig gerenderte Mail. Wirft, wenn kein Mailserver
   * eingerichtet ist – Aufrufer, für die das kein Fehler ist (etwa
   * Benachrichtigungen), fragen vorher `isReady()`.
   *
   * **`absicht` ist Pflicht (Phase 28).** Jede Mail läuft durch diesen einen
   * Engpass, also wird hier entschieden, ob sie überhaupt hinaus darf. Der
   * Parameter ist absichtlich nicht optional: Sonst wird die achte Mailart
   * eingebaut und die Prüfung vergessen – so meldet es der Übersetzer.
   *
   * Rückgabe `false` heißt „vom Admin abgeschaltet", nicht „fehlgeschlagen".
   * Das ist kein Fehler und wird auch nicht als einer vermerkt.
   */
  async send(to: string, mail: RenderedMail, absicht: MailAbsicht): Promise<boolean> {
    if (!(await this.notificationSettings.isAllowed(absicht.kind, absicht.audience))) {
      this.logger.log(
        `Mail an ${maskEmail(to)} nicht verschickt: ${absicht.kind} ist für ` +
          `${absicht.audience === 'TEAM' ? 'das Team' : 'Gäste'} abgeschaltet.`,
      );
      return false;
    }

    const credentials = await this.settingsService.getCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'Es ist kein Mailserver eingerichtet. Ein Administrator kann das unter Einstellungen nachholen.',
      );
    }

    const transporter = await this.getTransporter(credentials);
    try {
      await transporter.sendMail({
        from: { name: credentials.fromName, address: credentials.fromEmail },
        to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } catch (error) {
      // Der einzige Engpass, durch den jede Mail muss – deshalb wird hier
      // festgehalten, was nicht ankam (Phase 18). Bisher stand das nur im
      // Log; wer keins liest, erfuhr nie, dass der Kunde die Einladung gar
      // nicht bekommen hat.
      await this.recordFailure(to, mail.subject, error);
      throw error;
    }

    // Ein geglückter Versand räumt einen alten Eintrag weg: Wenn es wieder
    // geht, soll die Liste das nicht verschweigen.
    await this.clearFailure(to);
    this.logger.log(`Mail verschickt an ${maskEmail(to)}: ${mail.subject}`);
    return true;
  }

  /**
   * Eine Zeile je Empfänger und Betreff. Die Warteschlange versucht es
   * mehrfach – vier gleiche Zeilen sind kein besserer Hinweis als eine mit
   * „4 Versuche".
   */
  private async recordFailure(to: string, subject: string, error: unknown): Promise<void> {
    const meldung = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    this.logger.warn(`Mail an ${maskEmail(to)} gescheitert: ${meldung}`);
    try {
      await this.db
        .insert(mailFailures)
        .values({ recipient: to, subject, error: meldung })
        .onConflictDoUpdate({
          target: [mailFailures.recipient, mailFailures.subject],
          set: {
            error: meldung,
            attempts: sql`${mailFailures.attempts} + 1`,
            lastAt: new Date(),
          },
        });
    } catch (dbError) {
      // Der Vermerk ist eine Bequemlichkeit. Klemmt die Datenbank auch noch,
      // soll das nicht den eigentlichen Fehler überdecken.
      this.logger.error(`Fehlversand nicht vermerkbar: ${String(dbError)}`);
    }
  }

  private async clearFailure(to: string): Promise<void> {
    try {
      await this.db.delete(mailFailures).where(eq(mailFailures.recipient, to));
    } catch {
      // Siehe oben – nur Kosmetik.
    }
  }

  /**
   * In welcher Sprache liest dieser Empfänger? (Phase 26)
   *
   * Erst die eigene Wahl unter „Profil und Sicherheit", sonst die Vorgabe des
   * Workspace. Einen Browser gibt es hier nicht – eine Mail wird gelesen,
   * wenn niemand mehr davorsitzt.
   */
  async localeFor(eigene: string | null | undefined): Promise<Locale> {
    return this.locales.forUser(eigene);
  }

  /** Testmail aus dem Admin-Panel – meldet Fehler unverändert zurück. */
  async sendTestMail(to: string, locale?: string | null): Promise<void> {
    const credentials = await this.settingsService.getCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'Bitte zuerst Host, Port und Absenderadresse speichern und den Versand aktivieren.',
      );
    }
    await this.send(
      to,
      renderTestMail({
        host: credentials.host,
        fromEmail: credentials.fromEmail,
        brand: await this.brand(),
        locale: await this.localeFor(locale),
      }),
      // Von Hand ausgelöst und deshalb nie abschaltbar – wer sie anfordert,
      // will wissen, ob der Versandweg steht.
      { kind: 'test', audience: 'TEAM' },
    );
  }

  /**
   * Erscheinungsbild für die Vorlagen (Phase 10). Scheitert das Laden, bleibt
   * es beim Standard – eine Mail soll nicht wegen einer Farbe ausfallen.
   */
  async brand(): Promise<MailBrand> {
    try {
      const row = await this.settingsService.getRow();
      const colors = deriveBrandColors(row.brandAccent);
      return {
        title: normalizeBrandTitle(row.brandTitle),
        accent: colors.accent,
        accentContrast: colors.accentContrast,
      };
    } catch (error) {
      this.logger.warn(`Erscheinungsbild nicht ladbar, nehme den Standard: ${String(error)}`);
      return DEFAULT_MAIL_BRAND;
    }
  }

  /** Was zuletzt nicht ankam – für die Anzeige in den Einstellungen. */
  async listFailures(limit = 50): Promise<MailFailureDto[]> {
    const rows = await this.db
      .select()
      .from(mailFailures)
      .orderBy(desc(mailFailures.lastAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows.map((row) => ({
      id: row.id,
      recipient: row.recipient,
      subject: row.subject,
      error: row.error,
      attempts: row.attempts,
      firstAt: row.firstAt.toISOString(),
      lastAt: row.lastAt.toISOString(),
    }));
  }

  /** Einen Eintrag abhaken – oder ohne Angabe die ganze Liste. */
  async clearFailures(id?: string): Promise<void> {
    if (id) {
      await this.db.delete(mailFailures).where(eq(mailFailures.id, id));
      return;
    }
    await this.db.delete(mailFailures);
  }

  /** Vollständiger Abmelde-Link für die Fußzeile einer Benachrichtigung. */
  unsubscribeUrl(userId: string): string {
    const token = createUnsubscribeToken(userId, this.config.jwt.secret);
    return `${this.config.publicUrl}/abmelden?token=${encodeURIComponent(token)}`;
  }

  private async getTransporter(credentials: SmtpCredentials): Promise<Transporter> {
    if (credentials.authMethod === 'oauth2') {
      const accessToken = await this.ms365Oauth.getAccessToken(
        credentials.oauthTenantId,
        credentials.oauthClientId,
        credentials.oauthClientSecret,
      );
      // Das Zugriffstoken läuft nach etwa einer Stunde ab; anders als unten
      // wird hier deshalb nie zwischengehalten, sondern bei jedem Versand neu
      // mit dem gerade gültigen Token aufgebaut (der Ms365OauthService hält
      // seinerseits das Token vor, bis es fast abgelaufen ist).
      return createTransport({
        host: credentials.host,
        port: credentials.port,
        secure: credentials.secure,
        auth: { type: 'OAuth2', user: credentials.user, accessToken },
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }

    const key = JSON.stringify([
      credentials.host,
      credentials.port,
      credentials.secure,
      credentials.user,
      credentials.password ? 'gesetzt' : 'leer',
    ]);

    if (this.transporter && this.transporterKey === key) return this.transporter;

    this.transporter?.close();
    this.transporter = createTransport({
      host: credentials.host,
      port: credentials.port,
      secure: credentials.secure,
      auth: credentials.user
        ? { user: credentials.user, pass: credentials.password ?? '' }
        : undefined,
      // Ein hängender Mailserver darf keine Anfrage minutenlang blockieren.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    this.transporterKey = key;
    return this.transporter;
  }
}

/** Für Logs: `jo***@example.com` statt der vollen Adresse. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}
