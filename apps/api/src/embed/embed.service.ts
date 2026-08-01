import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { appSettings, shareLinks, videoVersions, videos } from '../db/schema';
import type { VideoVersionRow } from '../db/schema';

/**
 * Auflösung eines Einbett-Tokens.
 *
 * Bewusst eine eigene, sehr schmale Abfrage statt der allgemeinen
 * Zugriffsprüfung: Hier gibt es keinen Benutzer, an dem Rechte hängen könnten.
 * Es zählt allein, ob dieser Link existiert, freigeschaltet ist und noch gilt.
 */
@Injectable()
export class EmbedService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Der Link samt neuester fertiger Fassung – oder 404. */
  async resolveOrFail(token: string): Promise<{
    videoId: string;
    videoName: string;
    version: VideoVersionRow;
    brandTitle: string;
  }> {
    const [link] = await this.db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.token, token))
      .limit(1);

    // Eine einzige Meldung für alle Fälle: Ob der Link nie existierte, ein
    // gewöhnlicher Freigabe-Link ist oder zurückgezogen wurde, geht niemanden
    // etwas an, der nur eine Adresse ausprobiert.
    if (
      !link ||
      !link.isEmbed ||
      link.revokedAt !== null ||
      (link.expiresAt !== null && link.expiresAt.getTime() < Date.now())
    ) {
      throw new NotFoundException('Diese Einbettung gibt es nicht (mehr).');
    }

    // Projektfreigaben betten das Video ein, das zuletzt bearbeitet wurde –
    // eine ganze Projektliste in einem `iframe` wäre nicht das, was jemand
    // erwartet, der einen Player einbindet.
    const [video] = link.videoId
      ? await this.db.select().from(videos).where(eq(videos.id, link.videoId)).limit(1)
      : await this.db
          .select()
          .from(videos)
          .where(eq(videos.projectId, link.projectId as string))
          .orderBy(desc(videos.updatedAt))
          .limit(1);
    if (!video) throw new NotFoundException('Zu dieser Freigabe gibt es kein Video.');

    // Nur Endfassungen (Phase 23). Eine Einbettung steht auf einer fremden
    // Seite und wird dort niemandem erklärt – ein Zwischenstand hat da nichts
    // verloren. Fehlt eine finale Fassung, bleibt es bei derselben neutralen
    // Meldung wie oben; was der Betreiber tun muss, steht im Einbetten-Fenster.
    //
    // Und erst recht keine interne (Phase 27): Der Einbett-Link fragt gar
    // nicht nach einem Benutzer – hier gibt es niemanden, der zum Team
    // gehören könnte.
    const [version] = await this.db
      .select()
      .from(videoVersions)
      .where(
        and(
          eq(videoVersions.videoId, video.id),
          eq(videoVersions.status, 'READY'),
          eq(videoVersions.isFinal, true),
          eq(videoVersions.internal, false),
        ),
      )
      .orderBy(desc(videoVersions.versionNumber))
      .limit(1);
    if (!version) throw new NotFoundException('Diese Einbettung gibt es nicht (mehr).');

    const [settings] = await this.db.select().from(appSettings).limit(1);

    return {
      videoId: video.id,
      videoName: video.name,
      version,
      brandTitle: settings?.brandTitle?.trim() || 'Klappe',
    };
  }

  /**
   * Prüft, dass die angefragte Fassung wirklich zu diesem Link gehört. Ohne
   * diesen Schritt wäre jeder gültige Einbett-Token ein Schlüssel für jede
   * Fassung im Haus.
   */
  async versionForOrFail(token: string, versionId: string): Promise<VideoVersionRow> {
    const ziel = await this.resolveOrFail(token);
    if (ziel.version.id === versionId) return ziel.version;

    const [version] = await this.db
      .select()
      .from(videoVersions)
      .where(and(eq(videoVersions.id, versionId), eq(videoVersions.videoId, ziel.videoId)))
      .limit(1);
    // Auch hier die Endfassungs-Regel: Sonst wäre über die Fassungs-ID in der
    // Adresse doch wieder ein Zwischenstand zu holen – interne eingeschlossen.
    if (!version || version.status !== 'READY' || !version.isFinal || version.internal) {
      throw new NotFoundException('Diese Fassung gehört nicht zu dieser Einbettung.');
    }
    return version;
  }
}
