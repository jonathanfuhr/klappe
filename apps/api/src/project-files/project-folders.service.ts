import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectFolderDto } from '@klappe/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { type ProjectFolderRow, projectFiles, projectFolders } from '../db/schema';

/**
 * Die Ordner im Kunden-Bereich eines Projekts (Phase 15).
 *
 * Ein schlichter Baum über `parentId`. Die Liste kommt flach zum Client – bei
 * den Mengen eines Projektordners lohnt kein rekursives Nachladen, und der
 * Client baut sich Brotkrumen und Ebenen selbst.
 */
@Injectable()
export class ProjectFoldersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listForProject(projectId: string): Promise<ProjectFolderDto[]> {
    const rows = await this.db
      .select()
      .from(projectFolders)
      .where(eq(projectFolders.projectId, projectId))
      .orderBy(asc(projectFolders.parentId), sql`lower(${projectFolders.name})`);
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Legt eine Ordnerkette an – idempotent: Vorhandene Ebenen (gleicher Name
   * ohne Rücksicht auf Groß-/Kleinschreibung) werden wiederverwendet, fehlende
   * angelegt. Genau das braucht der Upload ganzer Ordner: Zwei Dateien aus
   * demselben Unterordner dürfen keine zwei Unterordner erzeugen.
   */
  async ensurePath(input: {
    projectId: string;
    parentId: string | null;
    path: string[];
    userId: string;
  }): Promise<ProjectFolderRow> {
    if (input.path.length === 0) {
      throw new BadRequestException('Der Ordnerpfad ist leer.');
    }
    if (input.parentId) await this.requireInProject(input.parentId, input.projectId);

    let parentId = input.parentId;
    let aktuell: ProjectFolderRow | null = null;
    for (const roh of input.path) {
      const name = roh.trim();
      if (!name) throw new BadRequestException('Ein Ordnername ist leer.');
      if (name.length > 200) throw new BadRequestException('Ein Ordnername ist zu lang.');

      const [vorhanden] = await this.db
        .select()
        .from(projectFolders)
        .where(
          and(
            eq(projectFolders.projectId, input.projectId),
            parentId === null ? isNull(projectFolders.parentId) : eq(projectFolders.parentId, parentId),
            sql`lower(${projectFolders.name}) = ${name.toLowerCase()}`,
          ),
        )
        .limit(1);

      if (vorhanden) {
        aktuell = vorhanden;
      } else {
        const [neu] = await this.db
          .insert(projectFolders)
          .values({
            projectId: input.projectId,
            parentId,
            name,
            createdById: input.userId,
          })
          .returning();
        aktuell = neu;
      }
      parentId = aktuell.id;
    }
    // `path` ist nicht leer, also steht hier immer ein Ordner.
    return aktuell as ProjectFolderRow;
  }

  async rename(id: string, name: string): Promise<ProjectFolderDto> {
    const [row] = await this.db
      .update(projectFolders)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(projectFolders.id, id))
      .returning();
    if (!row) throw new NotFoundException('Ordner nicht gefunden.');
    return this.toDto(row);
  }

  async findOneOrFail(id: string): Promise<ProjectFolderRow> {
    const [row] = await this.db
      .select()
      .from(projectFolders)
      .where(eq(projectFolders.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Ordner nicht gefunden.');
    return row;
  }

  /** Wirft, wenn der Ordner nicht zu diesem Projekt gehört. */
  async requireInProject(id: string, projectId: string): Promise<ProjectFolderRow> {
    const row = await this.findOneOrFail(id);
    if (row.projectId !== projectId) throw new NotFoundException('Ordner nicht gefunden.');
    return row;
  }

  /**
   * Löscht einen Ordner samt allem darunter. Die Datenbank räumt per Kaskade;
   * zurück kommen die Ablage-Schlüssel aller betroffenen Dateien, damit der
   * Aufrufer sie von der Platte nimmt – das Muster von Video und Projekt.
   */
  async remove(id: string): Promise<string[]> {
    const wurzel = await this.findOneOrFail(id);
    const ordnerIds = await this.collectSubtreeIds(wurzel);
    const dateien = await this.db
      .select({ storageKey: projectFiles.storageKey })
      .from(projectFiles)
      .where(sql`${projectFiles.folderId} in ${ordnerIds}`);
    await this.db.delete(projectFolders).where(eq(projectFolders.id, id));
    return dateien.map((datei) => datei.storageKey);
  }

  /** Alle IDs des Astes einsammeln – Breitensuche statt rekursivem SQL. */
  private async collectSubtreeIds(wurzel: ProjectFolderRow): Promise<string[]> {
    const alle = await this.db
      .select({ id: projectFolders.id, parentId: projectFolders.parentId })
      .from(projectFolders)
      .where(eq(projectFolders.projectId, wurzel.projectId));
    const kinder = new Map<string | null, string[]>();
    for (const ordner of alle) {
      const liste = kinder.get(ordner.parentId) ?? [];
      liste.push(ordner.id);
      kinder.set(ordner.parentId, liste);
    }
    const ergebnis: string[] = [];
    const offen = [wurzel.id];
    while (offen.length > 0) {
      const aktuell = offen.pop() as string;
      ergebnis.push(aktuell);
      offen.push(...(kinder.get(aktuell) ?? []));
    }
    return ergebnis;
  }

  /**
   * Pfadsegmente je Ordner – für die Pfade im ZIP-Archiv. Wurzel-Dateien
   * bekommen `[]`.
   */
  async pathMap(projectId: string): Promise<Map<string, string[]>> {
    const alle = await this.db
      .select({ id: projectFolders.id, parentId: projectFolders.parentId, name: projectFolders.name })
      .from(projectFolders)
      .where(eq(projectFolders.projectId, projectId));
    const nachId = new Map(alle.map((ordner) => [ordner.id, ordner]));
    const map = new Map<string, string[]>();
    for (const ordner of alle) {
      const pfad: string[] = [];
      let aktuell: typeof ordner | undefined = ordner;
      // Zyklen kann die Struktur nicht ausdrücken, aber ein Limit kostet nichts.
      for (let tiefe = 0; aktuell && tiefe < 50; tiefe += 1) {
        pfad.unshift(aktuell.name);
        aktuell = aktuell.parentId ? nachId.get(aktuell.parentId) : undefined;
      }
      map.set(ordner.id, pfad);
    }
    return map;
  }

  private toDto(row: ProjectFolderRow): ProjectFolderDto {
    return {
      id: row.id,
      projectId: row.projectId,
      parentId: row.parentId,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
