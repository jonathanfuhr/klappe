/**
 * Der Sync nach awork (Phase 30). Läuft im Worker, angestoßen über die
 * Warteschlange.
 *
 * Die Korrektur-Aufgabe ist das Herzstück: Die Kommentare einer Fassung
 * stehen als Aufgabe im awork-Projekt, die Eingetragenen als Bearbeiter, und
 * die Beschreibung entsteht bei jeder Änderung komplett neu.
 *
 * **Runden statt Wiederbeleben.** Ist die Aufgabe in awork erledigt und kommen
 * danach neue Kommentare, entsteht eine zweite Aufgabe. Eine abgehakte Aufgabe
 * wieder aufzureißen wäre unhöflich gegenüber dem, der sie abgehakt hat – und
 * neue Punkte still in ihre Beschreibung zu legen, wäre schlimmer: Sie stünden
 * dort, gelesen hätte sie niemand.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  commentBodyToPlainText,
  framesToTimecode,
  versionLabel as versionNumberLabel,
  versionWebPath,
} from '@klappe/shared';
import { and, asc, desc, eq, isNull, notExists, sql } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  aworkNotices,
  aworkTasks,
  commentMentions,
  comments,
  projectFiles,
  projects,
  shareLinks,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { SubscriptionsService } from '../mail/subscriptions.service';
import { AworkClient, AworkError, type AworkTask } from './awork.client';
import { AworkLinksService } from './awork-links.service';
import { AworkSettingsService } from './awork-settings.service';
import {
  type AworkKommentar,
  baueAenderungsHinweis,
  baueAufgabenTitel,
  baueBeschreibung,
  baueEndfassungText,
  baueErstbesuchText,
  baueFassungVerfuegbarText,
  baueKundenmaterialText,
} from './beschreibung';

@Injectable()
export class AworkSyncService {
  private readonly logger = new Logger(AworkSyncService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly client: AworkClient,
    private readonly settings: AworkSettingsService,
    private readonly links: AworkLinksService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Die Kommentare einer Fassung nach awork bringen.
   *
   * Gibt zurück, ob geschrieben wurde – für die Zeile im Protokoll. Ein
   * `false` ist kein Fehler: Meist heißt es „interne Fassung" oder „noch keine
   * Zuordnung", und beides ist ein gültiger Zustand.
   */
  async korrekturen(versionId: string): Promise<boolean> {
    if (!(await this.settings.isReady())) return false;

    const fassung = await this.ladeFassung(versionId);
    if (!fassung) return false;

    /*
     * Interne Fassungen bleiben im Haus (Entscheidung vom 03.08.2026). awork
     * ist das Projektmanagement, in dem auch der Kunde sichtbar wird – was
     * noch nicht freigegeben ist, hat dort nichts verloren.
     */
    if (fassung.internal) return false;

    const zuordnung = await this.links.resolve(fassung.projectId);
    if (zuordnung.art !== 'verknuepft') {
      this.logger.log(
        `Fassung ${versionId}: kein awork-Projekt zugeordnet (${zuordnung.grund.art}).`,
      );
      return false;
    }
    const aworkProjectId = zuordnung.link.aworkProjectId;

    const kommentare = await this.ladeKommentare(fassung);
    const bestand = await this.aktiveAufgabe(versionId, aworkProjectId);

    // Ohne Kommentare wird nichts angelegt – eine leere Aufgabe „Korrektur"
    // wäre nur Rauschen im Projekt. Eine bestehende wird aber gepflegt: Wer
    // den letzten Punkt löscht, soll das in awork auch sehen.
    if (kommentare.length === 0 && !bestand) return false;

    const url = `${this.config.publicUrl}${versionWebPath(fassung.videoId, fassung.versionNumber)}`;
    const beschreibung = baueBeschreibung({
      url,
      videoName: fassung.videoName,
      versionLabel: fassung.versionLabel,
      kommentare,
    });

    const aufgabe = bestand
      ? await this.erweitere(bestand, beschreibung, kommentare.length, url)
      : await this.legeAn({
          versionId,
          aworkProjectId,
          fassung,
          beschreibung,
          anzahl: kommentare.length,
          runde: (await this.hoechsteRunde(versionId)) + 1,
        });
    if (!aufgabe) return false;

    await this.setzeBearbeiter(aufgabe.aworkTask, fassung);
    await this.pflegeStatus(aufgabe.aworkTask, aworkProjectId, kommentare);
    return true;
  }

  // -------------------------------------------------------- Projekt-Kommentare

  /**
   * Kundenmaterial melden – gesammelt, wie die Sammelmail.
   *
   * Gemeldet wird, was noch keinen Vermerk hat. Dadurch stimmt die Meldung
   * auch dann, wenn während der Ruhezeit weitere Dateien dazukamen oder ein
   * früherer Versuch gescheitert ist.
   */
  async kundenmaterial(projectId: string): Promise<boolean> {
    return this.projektKommentar(projectId, async (aworkProjectId) => {
      const offen = await this.db
        .select({
          id: projectFiles.id,
          filename: projectFiles.filename,
          uploaderName: users.name,
        })
        .from(projectFiles)
        .leftJoin(users, eq(projectFiles.uploadedById, users.id))
        .where(
          and(
            eq(projectFiles.projectId, projectId),
            notExists(
              this.db
                .select({ eins: sql`1` })
                .from(aworkNotices)
                .where(
                  and(
                    eq(aworkNotices.kind, 'kundenmaterial'),
                    eq(aworkNotices.referenceId, projectFiles.id),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(projectFiles.createdAt));
      if (offen.length === 0) return null;

      // Bei mehreren Hochladenden bleibt der Name weg – „von Anna und drei
      // anderen" wäre eine Behauptung, die niemand geprüft hat.
      const namen = new Set(offen.map((datei) => datei.uploaderName).filter(Boolean));
      const text = baueKundenmaterialText({
        dateien: offen.map((datei) => datei.filename),
        hochgeladenVon: namen.size === 1 ? [...namen][0] : null,
        url: `${this.config.publicUrl}/projekte/${projectId}`,
      });

      await this.client.createProjectComment(aworkProjectId, text);
      await this.vermerke(
        projectId,
        'kundenmaterial',
        offen.map((datei) => datei.id),
      );
      return `${offen.length} Kundendatei(en)`;
    });
  }

  /** „Der Kunde hat zum ersten Mal reingeschaut." */
  async erstbesuch(userId: string, shareLinkId: string): Promise<boolean> {
    const [ziel] = await this.db
      .select({
        gastName: users.name,
        projectId: shareLinks.projectId,
        videoProjectId: videos.projectId,
        videoName: videos.name,
        projectName: projects.name,
      })
      .from(shareLinks)
      .innerJoin(users, eq(users.id, userId))
      .leftJoin(videos, eq(shareLinks.videoId, videos.id))
      .leftJoin(projects, eq(shareLinks.projectId, projects.id))
      .where(eq(shareLinks.id, shareLinkId))
      .limit(1);

    const projectId = ziel?.projectId ?? ziel?.videoProjectId;
    if (!ziel || !projectId) return false;

    return this.projektKommentar(projectId, async (aworkProjectId) => {
      const referenz = `${userId}:${shareLinkId}`;
      if (await this.schonVermerkt('erstbesuch', referenz)) return null;

      // Bei einer Videofreigabe steht der Projektname nicht am Link; dann
      // nennt die Meldung das Video – das ist ohnehin das, was der Gast sah.
      const zielName = ziel.projectName ?? ziel.videoName ?? 'Klappe';
      await this.client.createProjectComment(
        aworkProjectId,
        baueErstbesuchText({
          gastName: ziel.gastName,
          zielName,
          url: `${this.config.publicUrl}/projekte/${projectId}`,
        }),
      );
      await this.vermerke(projectId, 'erstbesuch', [referenz]);
      return `Erstbesuch ${ziel.gastName}`;
    });
  }

  /**
   * Eine Fassung ist beim Kunden angekommen.
   *
   * Zwei Wege führen hierher – fertig verarbeitet und nachträglich freigegeben.
   * Dass daraus nur eine Meldung wird, regelt der Vermerk; geprüft wird
   * zusätzlich der Zustand, denn zwischen Einreihen und Ausführen kann die
   * Fassung wieder intern gestellt worden sein.
   */
  async fassungVerfuegbar(versionId: string): Promise<boolean> {
    const fassung = await this.ladeFassung(versionId);
    if (!fassung || fassung.internal) return false;

    return this.projektKommentar(fassung.projectId, async (aworkProjectId) => {
      if (await this.schonVermerkt('fassung-verfuegbar', versionId)) return null;

      await this.client.createProjectComment(
        aworkProjectId,
        baueFassungVerfuegbarText({
          videoName: fassung.videoName,
          versionLabel: fassung.versionLabel,
          url: `${this.config.publicUrl}${versionWebPath(fassung.videoId, fassung.versionNumber)}`,
        }),
      );
      await this.vermerke(fassung.projectId, 'fassung-verfuegbar', [versionId]);
      return `${fassung.videoName} ${fassung.versionLabel}`;
    });
  }

  /** Endfassung markiert. Rührt bewusst keine Aufgabe an. */
  async endfassung(versionId: string): Promise<boolean> {
    const fassung = await this.ladeFassung(versionId);
    if (!fassung || fassung.internal) return false;

    return this.projektKommentar(fassung.projectId, async (aworkProjectId) => {
      if (await this.schonVermerkt('endfassung', versionId)) return null;

      await this.client.createProjectComment(
        aworkProjectId,
        baueEndfassungText({
          videoName: fassung.videoName,
          versionLabel: fassung.versionLabel,
          url: `${this.config.publicUrl}${versionWebPath(fassung.videoId, fassung.versionNumber)}`,
        }),
      );
      await this.vermerke(fassung.projectId, 'endfassung', [versionId]);
      return `${fassung.videoName} ${fassung.versionLabel}`;
    });
  }

  /**
   * Das Gerüst für alle Projekt-Kommentare: Anbindung prüfen, Zuordnung holen,
   * die eigentliche Arbeit machen lassen. Gibt die Arbeit `null` zurück, gab
   * es nichts zu melden.
   */
  private async projektKommentar(
    projectId: string,
    arbeit: (aworkProjectId: string) => Promise<string | null>,
  ): Promise<boolean> {
    if (!(await this.settings.isReady())) return false;

    const zuordnung = await this.links.resolve(projectId);
    if (zuordnung.art !== 'verknuepft') return false;

    const ergebnis = await arbeit(zuordnung.link.aworkProjectId);
    if (ergebnis === null) return false;
    this.logger.log(`awork-Kommentar in Projekt ${projectId}: ${ergebnis}`);
    return true;
  }

  private async schonVermerkt(kind: string, referenceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: aworkNotices.id })
      .from(aworkNotices)
      .where(and(eq(aworkNotices.kind, kind), eq(aworkNotices.referenceId, referenceId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Vermerkt das Gemeldete. Erst **nach** dem Schreiben: Scheitert der Aufruf
   * an awork, soll der nächste Anlauf es erneut versuchen – ein Vermerk davor
   * hieße, dass die Meldung still verloren geht.
   */
  private async vermerke(projectId: string, kind: string, referenzen: string[]): Promise<void> {
    if (referenzen.length === 0) return;
    await this.db
      .insert(aworkNotices)
      .values(referenzen.map((referenceId) => ({ projectId, kind, referenceId })))
      .onConflictDoNothing();
  }

  // ------------------------------------------------------------------ Aufgabe

  /**
   * Die Aufgabe, an der gerade gearbeitet wird – oder `null`, wenn eine neue
   * Runde fällig ist.
   *
   * Der Stand in awork zählt, nicht der gemerkte: Die Aufgabe kann dort
   * abgehakt oder gelöscht worden sein, seit Klappe zuletzt hinsah.
   */
  private async aktiveAufgabe(
    versionId: string,
    aworkProjectId: string,
  ): Promise<{ row: typeof aworkTasks.$inferSelect; aworkTask: AworkTask } | null> {
    const [row] = await this.db
      .select()
      .from(aworkTasks)
      .where(and(eq(aworkTasks.versionId, versionId), eq(aworkTasks.closed, false)))
      .orderBy(desc(aworkTasks.round))
      .limit(1);
    if (!row) return null;

    const aworkTask = await this.client.getTask(row.aworkTaskId);
    if (!aworkTask) {
      // In awork gelöscht: Zeile schließen, damit die nächste Runde greift.
      this.logger.log(`Aufgabe ${row.aworkTaskId} gibt es in awork nicht mehr – neue Runde.`);
      await this.db.update(aworkTasks).set({ closed: true }).where(eq(aworkTasks.id, row.id));
      return null;
    }

    if (aworkTask.closedOn) {
      this.logger.log(`Aufgabe ${row.aworkTaskId} ist erledigt – neue Runde.`);
      await this.db.update(aworkTasks).set({ closed: true }).where(eq(aworkTasks.id, row.id));
      return null;
    }

    // Umgezogen? Dann gehört sie nicht mehr zu diesem Projekt.
    if (aworkTask.raw.entityId && aworkTask.raw.entityId !== aworkProjectId) {
      this.logger.warn(`Aufgabe ${row.aworkTaskId} liegt in einem anderen awork-Projekt – neue Runde.`);
      await this.db.update(aworkTasks).set({ closed: true }).where(eq(aworkTasks.id, row.id));
      return null;
    }

    return { row, aworkTask };
  }

  private async hoechsteRunde(versionId: string): Promise<number> {
    const [row] = await this.db
      .select({ round: aworkTasks.round })
      .from(aworkTasks)
      .where(eq(aworkTasks.versionId, versionId))
      .orderBy(desc(aworkTasks.round))
      .limit(1);
    return row?.round ?? 0;
  }

  private async legeAn(input: {
    versionId: string;
    aworkProjectId: string;
    fassung: Fassung;
    beschreibung: string;
    anzahl: number;
    runde: number;
  }): Promise<{ aworkTask: AworkTask } | null> {
    const { taskListName, taskTitlePrefix } = await this.settings.syncConfig();

    const status = await this.client.listTaskStatuses(input.aworkProjectId);
    const offen = status.find((eintrag) => eintrag.type === 'todo') ?? status[0];
    if (!offen) {
      this.logger.warn(`awork-Projekt ${input.aworkProjectId} hat keine Aufgabenstatus.`);
      return null;
    }

    const liste = await this.findeOderLegeListeAn(input.aworkProjectId, taskListName);

    const aworkTask = await this.client.createTask({
      aworkProjectId: input.aworkProjectId,
      name: baueAufgabenTitel({
        prefix: taskTitlePrefix,
        videoName: input.fassung.videoName,
        versionLabel: input.fassung.versionLabel,
        round: input.runde,
      }),
      description: input.beschreibung,
      taskStatusId: offen.id,
      taskListId: liste?.id ?? null,
    });

    await this.db.insert(aworkTasks).values({
      versionId: input.versionId,
      aworkTaskId: aworkTask.id,
      round: input.runde,
      syncedCommentCount: input.anzahl,
      lastSyncedAt: new Date(),
    });
    this.logger.log(
      `Aufgabe ${aworkTask.id} für Fassung ${input.versionId} angelegt (Runde ${input.runde}).`,
    );
    return { aworkTask };
  }

  private async erweitere(
    bestand: { row: typeof aworkTasks.$inferSelect; aworkTask: AworkTask },
    beschreibung: string,
    anzahl: number,
    url: string,
  ): Promise<{ aworkTask: AworkTask } | null> {
    // Nichts zu tun: gleiche Anzahl und unveränderte Beschreibung. Erspart
    // awork einen Schreibvorgang, wenn nur ein Kommentar bearbeitet wurde,
    // dessen Text sich nicht auf die Aufgabe auswirkt.
    if (bestand.aworkTask.description === beschreibung) {
      await this.db
        .update(aworkTasks)
        .set({ syncedCommentCount: anzahl, lastSyncedAt: new Date() })
        .where(eq(aworkTasks.id, bestand.row.id));
      return { aworkTask: bestand.aworkTask };
    }

    await this.client.updateTaskDescription(bestand.aworkTask, beschreibung);

    /*
     * Der kurze Kommentar ist der eigentliche Weckruf: awork benachrichtigt
     * die Bearbeiter bei einem Kommentar, nicht bei einer still geänderten
     * Beschreibung. Nur beim Wachsen – für eine Korrektur an einem
     * bestehenden Punkt niemanden aufscheuchen.
     */
    const neue = anzahl - bestand.row.syncedCommentCount;
    if (neue > 0) {
      await this.client.createTaskComment(bestand.aworkTask.id, baueAenderungsHinweis(neue, url));
    }

    await this.db
      .update(aworkTasks)
      .set({ syncedCommentCount: anzahl, lastSyncedAt: new Date() })
      .where(eq(aworkTasks.id, bestand.row.id));
    return { aworkTask: bestand.aworkTask };
  }

  private async findeOderLegeListeAn(aworkProjectId: string, name: string) {
    const gesucht = name.trim().toLowerCase();
    if (!gesucht) return null;

    const listen = await this.client.listTaskLists(aworkProjectId);
    const treffer = listen.find((liste) => liste.name?.trim().toLowerCase() === gesucht);
    if (treffer) return treffer;

    try {
      return await this.client.createTaskList(aworkProjectId, name.trim());
    } catch (error) {
      // Ohne Liste ist die Aufgabe immer noch besser als keine Aufgabe.
      this.logger.warn(`Aufgabenliste „${name}" konnte nicht angelegt werden: ${beschreibe(error)}`);
      return null;
    }
  }

  /**
   * Bearbeiter setzen: die Eingetragenen und die Erwähnten.
   *
   * `setassignees` **ersetzt** die Liste, deshalb kommen die vorhandenen mit.
   * Wer in awork von Hand jemanden eingetragen hat, soll ihn behalten – Klappe
   * weiß nicht, warum er dort steht.
   */
  private async setzeBearbeiter(aworkTask: AworkTask, fassung: Fassung): Promise<void> {
    const eingetragen = await this.subscriptions.listForVideo(fassung.videoId);
    const klappeIds = eingetragen
      .filter((eintrag) => eintrag.subscribed || eintrag.inherited)
      .map((eintrag) => eintrag.user.id);

    const erwaehnt = await this.db
      .selectDistinct({ id: users.id })
      .from(commentMentions)
      .innerJoin(comments, eq(commentMentions.commentId, comments.id))
      .innerJoin(users, eq(commentMentions.userId, users.id))
      .where(
        and(
          eq(comments.versionId, fassung.versionId),
          isNull(comments.deletedAt),
          eq(users.isActive, true),
        ),
      );

    const alle = [...new Set([...klappeIds, ...erwaehnt.map((eintrag) => eintrag.id)])];
    const zuordnung = await this.links.aworkUserIds(alle);
    const gewuenscht = [...zuordnung.values()];
    if (gewuenscht.length === 0) return;

    const zusammen = [...new Set([...aworkTask.assigneeIds, ...gewuenscht])];
    // Nichts Neues? Dann auch kein Schreibvorgang.
    if (zusammen.length === aworkTask.assigneeIds.length) return;

    await this.client.setAssignees(aworkTask.id, zusammen);
  }

  /**
   * Aufgabe schließen, wenn alle Anmerkungen erledigt sind – nur wenn der
   * Schalter das erlaubt. Ab Werk aus: Ob eine Korrekturrunde abgeschlossen
   * ist, entscheidet in der Regel ein Mensch, nicht die Zahl der Haken.
   */
  private async pflegeStatus(
    aworkTask: AworkTask,
    aworkProjectId: string,
    kommentare: AworkKommentar[],
  ): Promise<void> {
    if (kommentare.length === 0) return;
    if (!kommentare.every((eintrag) => eintrag.erledigt)) return;
    if (!(await this.settings.eventEnabled('aufgabe-erledigen'))) return;

    const status = await this.client.listTaskStatuses(aworkProjectId);
    const fertig = status.find((eintrag) => eintrag.type === 'done');
    if (!fertig || aworkTask.taskStatusId === fertig.id) return;

    await this.client.changeTaskStatus(aworkTask.id, fertig.id);
    this.logger.log(`Aufgabe ${aworkTask.id} erledigt – alle Anmerkungen abgehakt.`);
  }

  // -------------------------------------------------------------------- Laden

  private async ladeFassung(versionId: string): Promise<Fassung | null> {
    const [row] = await this.db
      .select({
        versionNumber: videoVersions.versionNumber,
        internal: videoVersions.internal,
        fpsNum: videoVersions.fpsNum,
        fpsDen: videoVersions.fpsDen,
        dropFrame: videoVersions.dropFrame,
        startTimecodeFrames: videoVersions.startTimecodeFrames,
        videoId: videos.id,
        videoName: videos.name,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (!row) return null;

    const nummer = Number(row.versionNumber);
    return {
      ...row,
      versionId,
      versionNumber: nummer,
      versionLabel: versionNumberLabel(nummer),
    };
  }

  /** Die Kommentare der Fassung, fertig für die Beschreibung. */
  private async ladeKommentare(fassung: Fassung): Promise<AworkKommentar[]> {
    const rows = await this.db
      .select({
        id: comments.id,
        parentId: comments.parentId,
        body: comments.body,
        frame: comments.frame,
        annotation: comments.annotation,
        resolvedAt: comments.resolvedAt,
        createdAt: comments.createdAt,
        autor: users.name,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(eq(comments.versionId, fassung.versionId), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt));

    const wurzeln = new Map<string, AworkKommentar>();

    for (const row of rows) {
      if (row.parentId) continue;
      wurzeln.set(row.id, {
        frame: row.frame,
        timecode: this.timecode(fassung, row.frame),
        autor: row.autor,
        text: klartext(row.body),
        erledigt: Boolean(row.resolvedAt),
        hatZeichnung: Boolean(row.annotation),
        antworten: [],
      });
    }

    for (const row of rows) {
      if (!row.parentId) continue;
      const wurzel = wurzeln.get(row.parentId);
      if (!wurzel) continue;
      wurzel.antworten.push({ autor: row.autor, text: klartext(row.body) });
    }

    return [...wurzeln.values()];
  }

  private timecode(fassung: Fassung, frame: number | null): string | null {
    if (frame === null) return null;
    if (!fassung.fpsNum || !fassung.fpsDen) return null;
    return framesToTimecode(
      fassung.startTimecodeFrames + frame,
      { num: fassung.fpsNum, den: fassung.fpsDen },
      fassung.dropFrame,
    );
  }
}

interface Fassung {
  versionId: string;
  versionNumber: number;
  versionLabel: string;
  internal: boolean;
  fpsNum: number | null;
  fpsDen: number | null;
  dropFrame: boolean;
  startTimecodeFrames: number;
  videoId: string;
  videoName: string;
  projectId: string;
  projectName: string;
}

/**
 * Erwähnungen stehen im Text als `@[Name](uuid)`; in awork soll `@Name`
 * stehen. Die Person dort auch wirklich zu erwähnen ginge – awork kennt
 * `~[userId:UUID]` –, ist aber bewusst nicht gemacht: Sie steht ohnehin als
 * Bearbeiter an der Aufgabe, und eine zweite Benachrichtigung für dieselbe
 * Sache ist eine zu viel.
 */
function klartext(body: string): string {
  return commentBodyToPlainText(body).trim();
}

function beschreibe(error: unknown): string {
  return error instanceof AworkError || error instanceof Error ? error.message : String(error);
}
