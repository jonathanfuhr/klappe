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
  projectFieldValues,
  projectFiles,
  projects,
  shareLinks,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { SubscriptionsService } from '../mail/subscriptions.service';
import { AworkClient, AworkError, type AworkProject, type AworkTask, type AworkTaskStatus } from './awork.client';
import { AworkLinksService } from './awork-links.service';
import { AworkSettingsService } from './awork-settings.service';
import { freifeldWert, normalisiereProjektnummer } from './matching';
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
        `Fassung ${versionId}: kein awork-Projekt zugeordnet (${
          zuordnung.art === 'gesperrt' ? 'zuletzt vergeblich gesucht' : zuordnung.grund.art
        }).`,
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

    /*
     * Die Aufgabenstatus des Projekts holt sich der Auftrag höchstens einmal –
     * gebraucht werden sie beim Anlegen (für „offen") und beim Schließen (für
     * „erledigt"), und beides kann im selben Durchgang vorkommen. Erst beim
     * ersten Zugriff, damit ein Durchgang ohne Statuswechsel gar nicht danach
     * fragt.
     */
    let status: AworkTaskStatus[] | null = null;
    const statusHolen = async (): Promise<AworkTaskStatus[]> =>
      (status ??= await this.client.listTaskStatuses(aworkProjectId));

    const aufgabe = bestand
      ? await this.erweitere(bestand, beschreibung, kommentare.length, url)
      : await this.legeAn({
          versionId,
          aworkProjectId,
          fassung,
          beschreibung,
          anzahl: kommentare.length,
          runde: (await this.hoechsteRunde(versionId)) + 1,
          statusHolen,
        });
    if (!aufgabe) return false;

    await this.setzeBearbeiter(aufgabe.aworkTask, fassung);
    await this.pflegeStatus(aufgabe.aworkTask, kommentare, statusHolen);
    return true;
  }

  // ------------------------------------------------------------ Gegenrichtung

  /**
   * Nach neuen awork-Projekten sehen (Phase 30).
   *
   * Drei Dinge in einem Durchgang, weil sie dieselbe Projektliste brauchen:
   * neue Projekte übernehmen, fehlende Projektnummern angleichen und den
   * Klappe-Link nach awork schreiben.
   *
   * **Ohne Projektnummer wird nichts angelegt.** Interne Vorhaben brauchen
   * kein Klappe, und ein Projekt ohne Nummer ließe sich später auch nicht
   * zuordnen – es entstünde eine Karteileiche, die bei jedem Durchgang aufs
   * Neue anböte, sie anzulegen.
   */
  async projekteAbholen(): Promise<{ angelegt: number; verknuepft: number }> {
    if (!(await this.settings.isReady())) return { angelegt: 0, verknuepft: 0 };

    const config = await this.settings.syncConfig();
    if (!config.projectNumberFieldId || !config.aworkProjectNumberFieldId) {
      this.logger.warn('awork-Abholung übersprungen: Die Projektnummer-Felder sind nicht gewählt.');
      return { angelegt: 0, verknuepft: 0 };
    }

    const aworkProjekte = await this.client.listProjects();

    /*
     * Beide Nachschlagewerke **einmal** vor der Schleife, nicht je Projekt.
     * Vorher lud jedes awork-Projekt ohne Verknüpfung die gesamte
     * Projektnummer-Spalte neu – bei 200 Projekten hier und 300 dort waren das
     * 200 Abfragen über je 300 Zeilen, alle fünf Minuten.
     *
     * Beide Karten werden in der Schleife **mitgepflegt**: Ein frisch
     * angelegtes Projekt muss dem nächsten awork-Projekt mit derselben Nummer
     * sofort auffallen, sonst legte der Durchgang es ein zweites Mal an.
     */
    const nachAworkId = await this.links.alleLinks();
    const nachNummer = await this.klappeProjekteNachNummer(config.projectNumberFieldId);
    /*
     * Welche Klappe-Projekte schon vergeben sind.
     *
     * Nötig, weil zwei awork-Projekte dieselbe Projektnummer tragen können.
     * Ohne diese Prüfung bekäme das zweite denselben Klappe-Treffer, und
     * `speichere` schriebe die bestehende Verknüpfung still auf das neue
     * awork-Projekt um – die Korrekturen liefen fortan ins falsche Projekt,
     * ohne dass irgendwo etwas fehlschlägt.
     */
    const belegt = new Set(nachAworkId.values());

    let angelegt = 0;
    let verknuepft = 0;

    for (const projekt of aworkProjekte) {
      // Ein abgeschlossenes Projekt braucht kein Review mehr.
      if (projekt.isArchived) continue;

      const nummer = freifeldWert(projekt.customFields, config.aworkProjectNumberFieldId);

      try {
        const bestehend = nachAworkId.get(projekt.id) ?? null;

        /*
         * Keine Nummer drüben. Zum Anlegen reicht das nicht – wohl aber für die
         * Gegenrichtung: Ist das Projekt schon (etwa von Hand) verknüpft und
         * Klappe kennt eine Nummer, wandert sie nach awork. Das ist der Fall,
         * für den „fehlende Projektnummern angleichen" gemacht ist.
         */
        if (!nummer) {
          if (bestehend) await this.schreibeNummerNachAwork(bestehend, projekt);
          continue;
        }

        if (bestehend) {
          await this.nachpflegen(bestehend, projekt, nummer, config);
          continue;
        }

        // Gibt es das Projekt in Klappe schon, nur ohne Verknüpfung? Dann
        // verknüpfen statt ein zweites anlegen. Mehrere Klappe-Projekte mit
        // derselben Nummer klärt ein Mensch, nicht der Abholer – sonst hinge
        // die Zuordnung am Zufall der Sortierung.
        const schluessel = normalisiereProjektnummer(nummer);
        const kandidaten = (nachNummer.get(schluessel) ?? []).filter((id) => !belegt.has(id));
        if (kandidaten.length === 1) {
          const treffer = kandidaten[0];
          await this.links.speichere(treffer, projekt.id, projekt.name, 'nummer');
          nachAworkId.set(projekt.id, treffer);
          belegt.add(treffer);
          await this.nachpflegen(treffer, projekt, nummer, config);
          verknuepft += 1;
          continue;
        }
        if (kandidaten.length > 1) {
          this.logger.warn(
            `awork-Projekt „${projekt.name}": ${kandidaten.length} Klappe-Projekte tragen die Nummer ${nummer} – bitte von Hand zuordnen.`,
          );
          continue;
        }

        if (!config.autoCreateProjects) continue;

        const projectId = await this.legeKlappeProjektAn(projekt, nummer, config);
        await this.links.speichere(projectId, projekt.id, projekt.name, 'angelegt');
        nachAworkId.set(projekt.id, projectId);
        belegt.add(projectId);
        nachNummer.set(schluessel, [...(nachNummer.get(schluessel) ?? []), projectId]);
        await this.nachpflegen(projectId, projekt, nummer, config);
        angelegt += 1;
      } catch (error) {
        // Ein Projekt, das klemmt, darf den Rest des Durchgangs nicht mitreißen.
        this.logger.error(`awork-Projekt ${projekt.id} übersprungen: ${beschreibe(error)}`);
      }
    }

    await this.settings.merkePollLauf(new Date());
    if (angelegt > 0 || verknuepft > 0) {
      this.logger.log(`awork-Abholung: ${angelegt} angelegt, ${verknuepft} verknüpft.`);
    }
    return { angelegt, verknuepft };
  }

  /**
   * Alle Klappe-Projekte nach Projektnummer, in einem Zug.
   *
   * Verglichen wird über den **normalisierten** Wert, nicht über SQL:
   * `J26 Q3-P0153` und `j26q3p0153` sind dieselbe Nummer, und diese Regel
   * steht in `matching.ts`. Mehrere Projekte je Nummer sind möglich – wie
   * damit umzugehen ist, entscheidet der Aufrufer.
   */
  private async klappeProjekteNachNummer(fieldId: string): Promise<Map<string, string[]>> {
    const werte = await this.db
      .select({ projectId: projectFieldValues.projectId, value: projectFieldValues.value })
      .from(projectFieldValues)
      .where(eq(projectFieldValues.fieldId, fieldId));

    const karte = new Map<string, string[]>();
    for (const zeile of werte) {
      const schluessel = normalisiereProjektnummer(zeile.value);
      if (!schluessel) continue;
      const liste = karte.get(schluessel);
      if (liste) liste.push(zeile.projectId);
      else karte.set(schluessel, [zeile.projectId]);
    }
    return karte;
  }

  /**
   * Legt das Klappe-Projekt an.
   *
   * Wer es in awork angelegt hat, wird über seine Mailadresse eingetragen –
   * dieselbe Regel wie in Klappe selbst („wer anlegt, ist eingetragen"). Ohne
   * passendes Konto greift der Ersatz aus den Einstellungen; steht auch dort
   * niemand, bleibt das Projekt ohne Eintrag, und das kommt ins Protokoll:
   * Sonst lädt der Kunde Material hoch, und es merkt es keiner.
   */
  private async legeKlappeProjektAn(
    projekt: { id: string; name: string; companyName: string | null; createdBy: string | null },
    nummer: string,
    config: { projectNumberFieldId: string | null; fallbackUserId: string | null },
  ): Promise<string> {
    const anleger = projekt.createdBy ? await this.links.klappeUserFor(projekt.createdBy) : null;
    const eintragen = anleger ?? config.fallbackUserId;
    if (!anleger) {
      this.logger.warn(
        `awork-Projekt „${projekt.name}": Anleger hat kein Klappe-Konto – ${
          eintragen ? 'Ersatz eingetragen' : 'niemand eingetragen'
        }.`,
      );
    }

    const [row] = await this.db
      .insert(projects)
      .values({
        name: projekt.name.trim() || 'Ohne Namen',
        customer: projekt.companyName?.trim() || null,
        createdById: eintragen,
      })
      .returning();

    if (config.projectNumberFieldId) {
      await this.db
        .insert(projectFieldValues)
        .values({ projectId: row.id, fieldId: config.projectNumberFieldId, value: nummer })
        .onConflictDoNothing();
    }

    await this.subscriptions.subscribeProjectCreator(eintragen, row.id);
    this.logger.log(`Projekt „${projekt.name}" aus awork übernommen (${nummer}).`);
    return row.id;
  }

  /**
   * Was nach dem Verknüpfen zu tun bleibt: fehlende Projektnummer angleichen
   * und den Klappe-Link einmalig nach awork schreiben.
   *
   * Angeglichen wird nur, was **fehlt**. Einen vorhandenen Wert zu
   * überschreiben hieße zu entscheiden, welche Seite recht hat – und das kann
   * hier niemand wissen.
   */
  private async nachpflegen(
    projectId: string,
    projekt: { id: string; name: string },
    nummer: string,
    config: {
      projectNumberFieldId: string | null;
      aworkProjectNumberFieldId: string | null;
      syncProjectNumber: boolean;
      writeBackLink: boolean;
    },
  ): Promise<void> {
    if (config.syncProjectNumber && config.projectNumberFieldId) {
      const [vorhanden] = await this.db
        .select({ value: projectFieldValues.value })
        .from(projectFieldValues)
        .where(
          and(
            eq(projectFieldValues.projectId, projectId),
            eq(projectFieldValues.fieldId, config.projectNumberFieldId),
          ),
        )
        .limit(1);
      if (!vorhanden?.value?.trim()) {
        await this.db
          .insert(projectFieldValues)
          .values({ projectId, fieldId: config.projectNumberFieldId, value: nummer })
          .onConflictDoUpdate({
            target: [projectFieldValues.projectId, projectFieldValues.fieldId],
            set: { value: nummer, updatedAt: new Date() },
          });
      }
    }

    if (config.writeBackLink && !(await this.schonVermerkt('klappe-link', projectId))) {
      await this.client.createProjectComment(
        projekt.id,
        `<p><strong>Klappe:</strong> Die Freigaben und Korrekturen zu diesem Projekt laufen über <a href="${this.config.publicUrl}/projekte/${projectId}">Klappe</a>.</p>`,
      );
      await this.vermerke(projectId, 'klappe-link', [projectId]);
    }
  }

  /**
   * Die Projektnummer aus Klappe nach awork tragen, falls sie dort fehlt.
   * Läuft beim Verknüpfen mit – die Gegenrichtung zu `nachpflegen`.
   *
   * `bekannt` ist das awork-Projekt, wenn es der Aufrufer ohnehin schon in der
   * Hand hat – die Abholung hat es aus der Projektliste. Ohne diesen Weg holte
   * sie jedes Projekt ein zweites Mal einzeln.
   */
  async schreibeNummerNachAwork(projectId: string, bekannt?: AworkProject): Promise<void> {
    const config = await this.settings.syncConfig();
    if (!config.syncProjectNumber || !config.aworkProjectNumberFieldId) return;

    const link = await this.links.linkFor(projectId);
    if (!link) return;

    const nummer = await this.links.projektnummer(projectId);
    if (!nummer) return;

    const projekt =
      bekannt?.id === link.aworkProjectId ? bekannt : await this.client.getProject(link.aworkProjectId);
    if (!projekt) return;
    if (freifeldWert(projekt.customFields, config.aworkProjectNumberFieldId)) return;

    await this.client.setProjectCustomField(
      link.aworkProjectId,
      config.aworkProjectNumberFieldId,
      nummer,
    );
    this.logger.log(`Projektnummer ${nummer} nach awork geschrieben (${link.aworkProjectId}).`);
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
                    /*
                     * Ausdrücklich nach `text` gewandelt: `reference_id` ist
                     * Text (dort steht mal eine Fassung, mal eine Datei, mal
                     * ein Gast an einem Freigabe-Link), `project_files.id` ist
                     * `uuid`. Für `text = uuid` kennt Postgres keinen Operator
                     * und bricht die Abfrage ab – bei einem Spaltenvergleich
                     * gibt es anders als beim Parameter nichts zu erraten.
                     */
                    sql`${aworkNotices.referenceId} = ${projectFiles.id}::text`,
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
    statusHolen: () => Promise<AworkTaskStatus[]>;
  }): Promise<{ aworkTask: AworkTask } | null> {
    const { taskListName, taskTitlePrefix } = await this.settings.syncConfig();

    const status = await input.statusHolen();
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
    kommentare: AworkKommentar[],
    statusHolen: () => Promise<AworkTaskStatus[]>,
  ): Promise<void> {
    if (kommentare.length === 0) return;
    if (!kommentare.every((eintrag) => eintrag.erledigt)) return;
    if (!(await this.settings.eventEnabled('aufgabe-erledigen'))) return;

    const status = await statusHolen();
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
