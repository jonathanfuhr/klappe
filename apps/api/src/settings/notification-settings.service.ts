import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DEFAULT_PROJECT_FILE_DIGEST_MINUTES,
  MAX_PROJECT_FILE_DIGEST_MINUTES,
  type NotificationAudience,
  type NotificationKind,
  type NotificationSettingsDto,
  notificationApplies,
  notificationKindInfo,
  visibleNotificationKinds,
} from '@klappe/shared';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { appSettings, notificationSettings } from '../db/schema';
import { MAX_MAIL_DIGEST_MINUTES, SettingsService } from './settings.service';

export interface UpdateNotificationSettingsInput {
  kinds?: Array<{ kind: NotificationKind; team?: boolean; guest?: boolean }>;
  digestMinutes?: number;
  projectFileDigestMinutes?: number;
  mentionImmediate?: boolean;
}

/**
 * Welche Benachrichtigung an wen hinausgehen darf (Phase 28).
 *
 * Der Admin-Schalter ist die **oberste** von drei Ebenen: Er kann nur
 * zumachen, nie jemandem etwas aufzwingen. Darunter greift weiter, wer
 * eingetragen (Team) bzw. beteiligt (Gäste) ist, und ganz unten das
 * persönliche Abbestellen. Wer abbestellt hat, bleibt abbestellt – auch wenn
 * der Admin die Mailart einschaltet.
 */
@Injectable()
export class NotificationSettingsService {
  private readonly logger = new Logger(NotificationSettingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Der Prüfpunkt vor jedem Versand.
   *
   * Bewusst ohne Zwischenspeicher: Ein Nachschlagen über den Primärschlüssel
   * ist neben einem SMTP-Handschlag nicht messbar – und ein Zwischenspeicher
   * hieße, dass eine Änderung in den Einstellungen erst mit Verzögerung wirkt.
   * Genau das erwartet niemand, der gerade eine Mailart abgeschaltet hat.
   */
  async isAllowed(kind: NotificationKind, audience: NotificationAudience): Promise<boolean> {
    const info = notificationKindInfo(kind);
    if (info.alwaysOn) return true;
    // Für einen Kreis, den es bei dieser Mailart gar nicht gibt, wird auch
    // nichts verschickt – das wäre ein Fehler im Aufruf, kein Schalter.
    if (!notificationApplies(kind, audience)) return false;

    const [row] = await this.db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.kind, kind))
      .limit(1);
    // Fehlende Zeile heißt „an": Das Update ändert nichts an bestehenden Anlagen.
    if (!row) return true;
    return audience === 'TEAM' ? row.teamEnabled : row.guestEnabled;
  }

  async get(): Promise<NotificationSettingsDto> {
    const [row, gespeichert] = await Promise.all([
      this.settings.getRow(),
      this.db.select().from(notificationSettings),
    ]);
    const nachArt = new Map(gespeichert.map((eintrag) => [eintrag.kind, eintrag]));

    return {
      kinds: visibleNotificationKinds().map((info) => {
        const eintrag = nachArt.get(info.kind);
        const an = (audience: NotificationAudience): boolean | null => {
          if (!info.audiences.includes(audience)) return null;
          if (info.alwaysOn) return true;
          if (!eintrag) return true;
          return audience === 'TEAM' ? eintrag.teamEnabled : eintrag.guestEnabled;
        };
        return {
          kind: info.kind,
          team: an('TEAM'),
          guest: an('GUEST'),
          alwaysOn: Boolean(info.alwaysOn),
        };
      }),
      digestMinutes: row.mailDigestMinutes,
      projectFileDigestMinutes: row.mailProjectFileDigestMinutes,
      mentionImmediate: row.mailMentionImmediate,
    };
  }

  async update(input: UpdateNotificationSettingsInput): Promise<NotificationSettingsDto> {
    for (const eintrag of input.kinds ?? []) {
      const info = notificationKindInfo(eintrag.kind);
      // Der Anmeldecode lässt sich nicht abschalten. Die Oberfläche bietet es
      // gar nicht erst an; hier steht die Absicherung für alles andere.
      if (info.alwaysOn) {
        this.logger.warn(`Schalter für ${eintrag.kind} ignoriert – diese Art ist immer an.`);
        continue;
      }

      const team = info.audiences.includes('TEAM') ? eintrag.team : undefined;
      const guest = info.audiences.includes('GUEST') ? eintrag.guest : undefined;
      if (team === undefined && guest === undefined) continue;

      await this.db
        .insert(notificationSettings)
        .values({
          kind: eintrag.kind,
          teamEnabled: team ?? true,
          guestEnabled: guest ?? true,
        })
        .onConflictDoUpdate({
          target: notificationSettings.kind,
          set: {
            ...(team === undefined ? {} : { teamEnabled: team }),
            ...(guest === undefined ? {} : { guestEnabled: guest }),
            updatedAt: new Date(),
          },
        });
    }

    if (
      input.digestMinutes !== undefined ||
      input.projectFileDigestMinutes !== undefined ||
      input.mentionImmediate !== undefined
    ) {
      await this.settings.getRow();
      await this.db
        .update(appSettings)
        .set({
          ...(input.digestMinutes === undefined
            ? {}
            : {
                mailDigestMinutes: Math.max(
                  0,
                  Math.min(MAX_MAIL_DIGEST_MINUTES, Math.round(input.digestMinutes)),
                ),
              }),
          ...(input.projectFileDigestMinutes === undefined
            ? {}
            : {
                mailProjectFileDigestMinutes: Math.max(
                  0,
                  Math.min(
                    MAX_PROJECT_FILE_DIGEST_MINUTES,
                    Math.round(input.projectFileDigestMinutes),
                  ),
                ),
              }),
          ...(input.mentionImmediate === undefined
            ? {}
            : { mailMentionImmediate: input.mentionImmediate }),
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 1));
    }

    return this.get();
  }

  /** Ruhezeit für Kundenmaterial; `0` schickt sofort und einzeln. */
  async projectFileDigestMinutes(): Promise<number> {
    const row = await this.settings.getRow();
    return row.mailProjectFileDigestMinutes ?? DEFAULT_PROJECT_FILE_DIGEST_MINUTES;
  }

  /** Überspringen Erwähnungen die Ruhezeit? */
  async mentionImmediate(): Promise<boolean> {
    return (await this.settings.getRow()).mailMentionImmediate;
  }
}
