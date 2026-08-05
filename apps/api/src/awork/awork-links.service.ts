/**
 * Die Zuordnung zwischen beiden Welten (Phase 30): Projekt zu Projekt und
 * Person zu Person.
 *
 * Beide folgen demselben Gedanken – **einmal suchen, dann merken**. Die
 * Projektzuordnung bleibt dauerhaft stehen (Namen dürfen sich danach frei
 * auseinanderentwickeln), die Nutzerzuordnung verfällt nach einem Tag, damit
 * neu eingetretene Kolleginnen von selbst dazukommen.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AworkMatchSource, AworkProjectLinkDto } from '@klappe/shared';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import {
  aworkIgnoredProjects,
  aworkProjectLinks,
  aworkUsers,
  projectFieldValues,
  projects,
  users,
} from '../db/schema';
import { AworkClient } from './awork.client';
import { AworkSettingsService } from './awork-settings.service';
import { type AworkKandidat, type ProjektTreffer, findeProjekt, freifeldWert } from './matching';

/**
 * Wie lange die Nutzerzuordnung gilt. Ein Tag: lang genug, damit nicht jede
 * Aufgabe die awork-Nutzerliste holt, kurz genug, dass ein neuer Kollege
 * spätestens am nächsten Morgen Bearbeiter werden kann.
 */
export const AWORK_USER_CACHE_HOURS = 24;

/**
 * So lange wird eine erfolglose Suche nicht wiederholt.
 *
 * Ohne diese Sperre holte **jeder** Kommentar in einem Projekt, dessen Nummer
 * in awork nicht vorkommt – ein Tippfehler genügt –, die vollständige
 * awork-Projektliste. Fünfzehn Minuten sind kurz genug, dass ein neu
 * angelegtes awork-Projekt zügig gefunden wird, und lang genug, dass ein
 * Nachmittag Kommentare nicht dieselbe Liste dreißigmal abruft.
 *
 * Im Speicher und nicht in der Datenbank: Nach einem Neustart darf ruhig
 * wieder gesucht werden, und die Sperre ist nichts, was jemand nachlesen will.
 */
const SUCHSPERRE_MS = 15 * 60 * 1000;

@Injectable()
export class AworkLinksService {
  private readonly logger = new Logger(AworkLinksService.name);
  /** Projekt-Kennung → wann zuletzt vergeblich gesucht wurde. */
  private readonly erfolglos = new Map<string, number>();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly client: AworkClient,
    private readonly settings: AworkSettingsService,
  ) {}

  // ------------------------------------------------------------------ Projekte

  async linkFor(projectId: string): Promise<AworkProjectLinkDto | null> {
    const [row] = await this.db
      .select()
      .from(aworkProjectLinks)
      .where(eq(aworkProjectLinks.projectId, projectId))
      .limit(1);
    return row ? toLinkDto(row) : null;
  }

  /**
   * Alle Verknüpfungen auf einmal, nach awork-Kennung.
   *
   * Für die Abholung, die sonst je awork-Projekt eine Abfrage bräuchte. Die
   * Tabelle hat höchstens so viele Zeilen wie es Projekte gibt – das passt in
   * einen Zug.
   */
  async alleLinks(): Promise<Map<string, string>> {
    const zeilen = await this.db
      .select({
        aworkProjectId: aworkProjectLinks.aworkProjectId,
        projectId: aworkProjectLinks.projectId,
      })
      .from(aworkProjectLinks);
    return new Map(zeilen.map((zeile) => [zeile.aworkProjectId, zeile.projectId]));
  }

  /** Umgekehrt: Gehört dieses awork-Projekt schon zu einem Klappe-Projekt? */
  async linkForAworkProject(aworkProjectId: string): Promise<AworkProjectLinkDto | null> {
    const [row] = await this.db
      .select()
      .from(aworkProjectLinks)
      .where(eq(aworkProjectLinks.aworkProjectId, aworkProjectId))
      .limit(1);
    return row ? toLinkDto(row) : null;
  }

  /**
   * Die Projektnummer eines Klappe-Projekts – aus dem Feld, das in den
   * Einstellungen dafür bestimmt wurde. Ohne diese Wahl gibt es keine Nummer,
   * und ohne Nummer findet die Zuordnung nichts.
   */
  async projektnummer(projectId: string): Promise<string | null> {
    const { projectNumberFieldId } = await this.settings.syncConfig();
    if (!projectNumberFieldId) return null;

    const [row] = await this.db
      .select({ value: projectFieldValues.value })
      .from(projectFieldValues)
      .where(
        and(
          eq(projectFieldValues.projectId, projectId),
          eq(projectFieldValues.fieldId, projectNumberFieldId),
        ),
      )
      .limit(1);
    const wert = row?.value?.trim();
    return wert ? wert : null;
  }

  /**
   * Die Zuordnung für ein Projekt – gespeichert oder frisch gesucht.
   *
   * Gefunden wird über die Projektnummer, der Kundenname ist die Gegenprobe
   * (siehe `matching.ts`). Alles außer einem eindeutigen Treffer wird
   * **nicht** gespeichert, sondern gemeldet: Eine falsche Zuordnung schriebe
   * Korrekturen ins Projekt eines fremden Kunden, und das fällt niemandem auf.
   */
  async resolve(
    projectId: string,
    /** `frisch` übergeht die Suchsperre – für den Knopf „Zuordnung suchen". */
    options: { frisch?: boolean } = {},
  ): Promise<
    | { art: 'verknuepft'; link: AworkProjectLinkDto }
    // Ein Treffer kommt als `verknuepft` zurück – hier bleibt nur, was schiefging.
    | { art: 'nicht-moeglich'; grund: Exclude<ProjektTreffer, { art: 'treffer' }> }
    /** Vor Kurzem schon vergeblich gesucht – es wurde nichts abgefragt. */
    | { art: 'gesperrt' }
  > {
    const bestehend = await this.linkFor(projectId);
    if (bestehend) return { art: 'verknuepft', link: bestehend };

    const [projekt] = await this.db
      .select({ customer: projects.customer })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!projekt) return { art: 'nicht-moeglich', grund: { art: 'ohne-nummer' } };

    /*
     * Ohne Projektnummer wird gar nichts abgefragt – die Prüfung liest nur die
     * eigene Datenbank. Deshalb steht sie **vor** der Suchsperre: Wer die
     * Nummer nachträgt, soll beim nächsten Kommentar zugeordnet werden und
     * nicht erst eine Viertelstunde später.
     */
    const nummer = await this.projektnummer(projectId);
    if (!nummer) return { art: 'nicht-moeglich', grund: { art: 'ohne-nummer' } };

    if (!options.frisch) {
      const zuletzt = this.erfolglos.get(projectId);
      if (zuletzt && Date.now() - zuletzt < SUCHSPERRE_MS) return { art: 'gesperrt' };
    }

    const treffer = findeProjekt(nummer, projekt.customer, await this.kandidaten());
    if (treffer.art !== 'treffer') {
      this.logger.log(`Projekt ${projectId}: keine awork-Zuordnung (${treffer.art}).`);
      this.erfolglos.set(projectId, Date.now());
      return { art: 'nicht-moeglich', grund: treffer };
    }

    const link = await this.speichere(projectId, treffer.kandidat.id, treffer.kandidat.name, 'nummer');
    return { art: 'verknuepft', link };
  }

  /** Die awork-Projekte in der Form, die `findeProjekt` erwartet. */
  async kandidaten(): Promise<AworkKandidat[]> {
    const { aworkProjectNumberFieldId } = await this.settings.syncConfig();
    const projekte = await this.client.listProjects();
    return projekte.map((eintrag) => ({
      id: eintrag.id,
      name: eintrag.name,
      companyName: eintrag.companyName,
      projectNumber: freifeldWert(eintrag.customFields, aworkProjectNumberFieldId),
    }));
  }

  async speichere(
    projectId: string,
    aworkProjectId: string,
    aworkProjectName: string | null,
    matchedBy: AworkMatchSource,
  ): Promise<AworkProjectLinkDto> {
    const [row] = await this.db
      .insert(aworkProjectLinks)
      .values({ projectId, aworkProjectId, aworkProjectName, matchedBy })
      .onConflictDoUpdate({
        target: aworkProjectLinks.projectId,
        set: { aworkProjectId, aworkProjectName, matchedBy },
      })
      .returning();
    // Gefunden heisst: Die Suchsperre hat sich erledigt.
    this.erfolglos.delete(projectId);
    /*
     * Und ein früherer „nicht mehr holen"-Vermerk ebenso: Wer dieses
     * awork-Projekt wieder zuordnet, will es wieder haben (Nachtrag 1.5).
     */
    await this.db
      .delete(aworkIgnoredProjects)
      .where(eq(aworkIgnoredProjects.aworkProjectId, aworkProjectId));
    this.logger.log(`Projekt ${projectId} ↔ awork ${aworkProjectId} (${matchedBy}).`);
    return toLinkDto(row);
  }

  async entferne(projectId: string): Promise<void> {
    await this.db.delete(aworkProjectLinks).where(eq(aworkProjectLinks.projectId, projectId));
    // Wer von Hand löst, will danach neu suchen dürfen.
    this.erfolglos.delete(projectId);
  }

  // -------------------------------------------------------------------- Nutzer

  /**
   * Klappe-Nutzer zu awork-Nutzern, über die Mailadresse.
   *
   * Wer in awork nicht vorkommt – Gäste etwa, oder ein Team-Mitglied ohne
   * awork-Konto –, fällt still heraus: Ein Bearbeiter, den es dort nicht gibt,
   * lässt sich nicht eintragen, und daran soll nicht der ganze Sync scheitern.
   */
  async aworkUserIds(userIds: string[]): Promise<Map<string, string>> {
    const ergebnis = new Map<string, string>();
    if (userIds.length === 0) return ergebnis;

    const frisch = new Date(Date.now() - AWORK_USER_CACHE_HOURS * 60 * 60 * 1000);
    const gespeichert = await this.db
      .select()
      .from(aworkUsers)
      .where(inArray(aworkUsers.userId, userIds));

    const veraltet: string[] = [];
    for (const zeile of gespeichert) {
      if (zeile.updatedAt > frisch) ergebnis.set(zeile.userId, zeile.aworkUserId);
      else veraltet.push(zeile.userId);
    }

    const fehlend = userIds.filter((id) => !ergebnis.has(id));
    if (fehlend.length === 0) return ergebnis;

    // Eine Runde für alle Fehlenden zusammen – nicht eine je Person.
    const nachMail = new Map(
      (await this.client.listUsers())
        .filter((person) => person.email && !person.isDeactivated)
        .map((person) => [person.email as string, person.id]),
    );

    const klappeNutzer = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, fehlend));

    const neu: { userId: string; aworkUserId: string }[] = [];
    for (const person of klappeNutzer) {
      const aworkId = nachMail.get(person.email.trim().toLowerCase());
      if (!aworkId) continue;
      ergebnis.set(person.id, aworkId);
      neu.push({ userId: person.id, aworkUserId: aworkId });
    }

    if (neu.length > 0) {
      await this.db
        .insert(aworkUsers)
        .values(neu)
        .onConflictDoUpdate({
          target: aworkUsers.userId,
          // `excluded` ist der Wert, den dieser Einfügeversuch mitgebracht hat –
          // beim Sammel-Insert der einzige Weg, je Zeile den richtigen zu nehmen.
          set: { aworkUserId: sql`excluded.awork_user_id`, updatedAt: new Date() },
        });
    }
    // Wer nicht mehr gefunden wurde, verliert seinen veralteten Eintrag –
    // sonst bliebe eine Kennung stehen, die es in awork nicht mehr gibt.
    const verschwunden = veraltet.filter((id) => !ergebnis.has(id));
    if (verschwunden.length > 0) {
      await this.db.delete(aworkUsers).where(inArray(aworkUsers.userId, verschwunden));
    }

    return ergebnis;
  }

  /** Ein awork-Nutzer zurück auf ein Klappe-Konto – für die Gegenrichtung. */
  async klappeUserFor(aworkUserId: string): Promise<string | null> {
    const [gespeichert] = await this.db
      .select({ userId: aworkUsers.userId })
      .from(aworkUsers)
      .where(eq(aworkUsers.aworkUserId, aworkUserId))
      .limit(1);
    if (gespeichert) return gespeichert.userId;

    const person = (await this.client.listUsers()).find((eintrag) => eintrag.id === aworkUserId);
    if (!person?.email) return null;

    const [treffer] = await this.db
      .select({ id: users.id, isActive: users.isActive, role: users.role })
      .from(users)
      .where(eq(users.email, person.email))
      .limit(1);
    // Ein Gast ist kein Bearbeiter, und ein gesperrtes Konto liest nichts mehr.
    if (!treffer || !treffer.isActive || treffer.role === 'GUEST') return null;

    await this.db
      .insert(aworkUsers)
      .values({ userId: treffer.id, aworkUserId })
      .onConflictDoUpdate({ target: aworkUsers.userId, set: { aworkUserId, updatedAt: new Date() } });
    return treffer.id;
  }

  /** Räumt Zuordnungen weg, die länger als eine Woche nicht bestätigt wurden. */
  async raeumeNutzerCache(): Promise<void> {
    const grenze = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await this.db.delete(aworkUsers).where(lt(aworkUsers.updatedAt, grenze));
  }
}

function toLinkDto(row: typeof aworkProjectLinks.$inferSelect): AworkProjectLinkDto {
  return {
    projectId: row.projectId,
    aworkProjectId: row.aworkProjectId,
    aworkProjectName: row.aworkProjectName,
    matchedBy: row.matchedBy as AworkMatchSource,
    linkedAt: row.createdAt.toISOString(),
  };
}
