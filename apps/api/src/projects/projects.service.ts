import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ProjectDto, TagRefDto, UserRole } from '@klappe/shared';
import { colorForTagName } from '@klappe/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AccessService, type AccessScope } from '../access/access.service';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import {
  projectFieldDefs,
  projectFieldValues,
  projectFiles,
  projectTags,
  projects,
  tags,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { StorageService } from '../storage/storage.service';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto';

type ProjectQueryRow = {
  project: typeof projects.$inferSelect;
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  creatorRole: UserRole | null;
  videoCount: number;
  fileCount: number;
  tags: { id: string; name: string; color: string | null }[] | null;
  fields: { fieldId: string; name: string; value: string }[] | null;
};

/** Wie die Projektliste gefiltert und sortiert werden soll (Phase 12/15/16). */
export interface ProjectListOptions {
  tagIds?: string[];
  /** `all` verlangt sämtliche gewählten Tags, `any` genügt eines. */
  tagMatch?: 'any' | 'all';
  /** `field:<uuid>` sortiert nach einem benutzerdefinierten Feld. */
  sort?: 'updated' | 'created' | 'name' | 'customer' | `field:${string}`;
  /** Exakte Kundennamen (mehrere = eines genügt); Schreibweise egal. */
  customers?: string[];
  /** Je Feld: gewählte Werte (mehrere = eines genügt); Felder untereinander UND. */
  fieldFilters?: { fieldId: string; values: string[] }[];
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  private baseQuery() {
    return this.db
      .select({
        project: projects,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        creatorRole: users.role,
        videoCount: sql<number>`(select count(*)::int from ${videos} where ${videos.projectId} = ${projects.id})`,
        fileCount: sql<number>`(select count(*)::int from ${projectFiles} where ${projectFiles.projectId} = ${projects.id})`,
        // Die Schlagworte kommen als JSON aus derselben Abfrage; sonst
        // bräuchte die Projektliste eine zweite Runde pro Zeile.
        tags: sql<{ id: string; name: string; color: string | null }[] | null>`(
          select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by lower(t.name))
          from ${projectTags} pt
          join ${tags} t on t.id = pt.tag_id
          where pt.project_id = ${projects.id}
        )`,
        // Nur belegte Felder – die vollständige Definitionsliste holt sich das
        // Formular über /v1/project-fields.
        fields: sql<{ fieldId: string; name: string; value: string }[] | null>`(
          select json_agg(json_build_object('fieldId', d.id, 'name', d.name, 'value', v.value) order by d.sort_order, lower(d.name))
          from ${projectFieldValues} v
          join ${projectFieldDefs} d on d.id = v.field_id
          where v.project_id = ${projects.id}
        )`,
      })
      .from(projects)
      .leftJoin(users, eq(projects.createdById, users.id));
  }

  /**
   * Team-Mitglieder sehen laut Konzept alle Projekte des Workspace. Gäste
   * sehen ausschließlich das, wofür es eine Freigabe gibt – die Liste wird
   * deshalb schon in der Abfrage eingeschränkt und nicht erst danach.
   */
  async list(scope: AccessScope, options: ProjectListOptions = {}): Promise<ProjectDto[]> {
    const bedingungen = [];

    if (!scope.unrestricted) {
      const allowed = this.accessService.visibleProjects(scope);
      if (allowed.length === 0) return [];
      bedingungen.push(inArray(projects.id, allowed));
    }

    const tagIds = options.tagIds ?? [];
    if (tagIds.length > 0) {
      // `all`: Das Projekt muss jedes gewählte Schlagwort tragen – gezählt
      // wird, wie viele der gewählten es hat. `any`: eines genügt.
      bedingungen.push(
        options.tagMatch === 'all'
          ? sql`(select count(*) from ${projectTags} pt where pt.project_id = ${projects.id} and pt.tag_id in ${tagIds}) = ${tagIds.length}`
          : sql`exists (select 1 from ${projectTags} pt where pt.project_id = ${projects.id} and pt.tag_id in ${tagIds})`,
      );
    }

    const kunden = (options.customers ?? []).map((name) => name.toLowerCase());
    if (kunden.length > 0) {
      // Mehrere gewählte Kunden heißt: einer davon genügt.
      bedingungen.push(sql`lower(coalesce(${projects.customer}, '')) in ${kunden}`);
    }

    // Je gewähltem Feld genügt einer der Werte; verschiedene Felder müssen
    // alle passen – dieselbe Logik wie „alle gewählten" bei den Schlagworten.
    for (const filter of options.fieldFilters ?? []) {
      if (filter.values.length === 0) continue;
      const werte = filter.values.map((wert) => wert.toLowerCase());
      bedingungen.push(
        sql`exists (
          select 1 from ${projectFieldValues} v
          where v.project_id = ${projects.id}
            and v.field_id = ${filter.fieldId}
            and lower(v.value) in ${werte}
        )`,
      );
    }

    const query = this.baseQuery();
    const gefiltert = bedingungen.length > 0 ? query.where(and(...bedingungen)) : query;

    const feldSortierung = options.sort?.startsWith('field:')
      ? options.sort.slice('field:'.length)
      : null;
    const sortiert =
      options.sort === 'name'
        ? gefiltert.orderBy(sql`lower(${projects.name})`)
        : options.sort === 'created'
          ? gefiltert.orderBy(desc(projects.createdAt))
          : options.sort === 'customer'
            ? // Projekte ohne Kunden ans Ende, sonst wäre die erste „Gruppe" die
              // namenlose – innerhalb des Kunden entscheidet der Projektname.
              gefiltert.orderBy(
                sql`(${projects.customer} is null or ${projects.customer} = '')`,
                sql`lower(coalesce(${projects.customer}, ''))`,
                sql`lower(${projects.name})`,
              )
            : feldSortierung
              ? // Nach einem benutzerdefinierten Feld – Projekte ohne Wert ans
                // Ende, dieselbe Ordnung wie beim Kunden.
                gefiltert.orderBy(
                  sql`(select v.value from ${projectFieldValues} v where v.project_id = ${projects.id} and v.field_id = ${feldSortierung}) is null`,
                  sql`lower((select v.value from ${projectFieldValues} v where v.project_id = ${projects.id} and v.field_id = ${feldSortierung}))`,
                  sql`lower(${projects.name})`,
                )
              : gefiltert.orderBy(desc(projects.updatedAt));

    const rows = await sortiert;
    return rows.map((row) => this.toDto(row, scope));
  }

  /**
   * Alle Kundennamen samt Projektzahl – die Grundlage für Filter und
   * Verwaltung. „Kunde" ist bewusst keine eigene Tabelle, sondern der
   * Textwert am Projekt: Ein Workspace, überschaubare Mengen, und ein
   * Tippfehler lässt sich mit `renameCustomer` über alle Projekte hinweg
   * geraderücken. Gäste sehen nur die Kunden ihrer freigegebenen Projekte.
   */
  async listCustomers(scope: AccessScope): Promise<{ name: string; projectCount: number }[]> {
    const bedingungen = [sql`${projects.customer} is not null and ${projects.customer} <> ''`];
    if (!scope.unrestricted) {
      const allowed = this.accessService.visibleProjects(scope);
      if (allowed.length === 0) return [];
      bedingungen.push(inArray(projects.id, allowed));
    }
    const rows = await this.db
      .select({
        name: sql<string>`${projects.customer}`,
        projectCount: sql<number>`count(*)::int`,
      })
      .from(projects)
      .where(and(...bedingungen))
      .groupBy(projects.customer)
      .orderBy(sql`lower(${projects.customer})`);
    return rows;
  }

  /**
   * Kunden umbenennen oder entfernen – wirkt über alle Projekte mit diesem
   * Namen. `nach = null` leert das Feld („Kunde löschen“); die Projekte selbst
   * bleiben unangetastet. Tragen zwei Schreibweisen denselben neuen Namen,
   * verschmelzen sie dadurch von selbst.
   */
  async renameCustomer(von: string, nach: string | null): Promise<number> {
    const rows = await this.db
      .update(projects)
      .set({ customer: nach, updatedAt: new Date() })
      .where(sql`lower(coalesce(${projects.customer}, '')) = ${von.toLowerCase()}`)
      .returning({ id: projects.id });
    if (rows.length === 0) {
      throw new NotFoundException('Kein Projekt trägt diesen Kundennamen.');
    }
    return rows.length;
  }

  async findOneOrFail(id: string, scope: AccessScope): Promise<ProjectDto> {
    this.accessService.assertCanViewProject(scope, id);
    const [row] = await this.baseQuery().where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    return this.toDto(row, scope);
  }

  /** Wirft, wenn es das Projekt nicht gibt – für Unterrouten wie Videos. */
  async assertExists(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
  }

  async create(dto: CreateProjectDto, user: RequestUser, scope: AccessScope): Promise<ProjectDto> {
    const [row] = await this.db
      .insert(projects)
      .values({
        name: dto.name.trim(),
        customer: dto.customer?.trim() || null,
        description: dto.description?.trim() || null,
        createdById: user.id,
      })
      .returning();
    return this.findOneOrFail(row.id, scope);
  }

  async update(id: string, dto: UpdateProjectDto, scope: AccessScope): Promise<ProjectDto> {
    const [row] = await this.db
      .update(projects)
      .set({
        name: dto.name === undefined ? undefined : dto.name.trim(),
        customer: dto.customer === undefined ? undefined : dto.customer.trim() || null,
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    return this.findOneOrFail(row.id, scope);
  }

  /**
   * Löscht das Projekt samt Videos, Versionen und Kommentaren (per Kaskade)
   * und gibt die Ablage-Schlüssel zurück, damit der Aufrufer die Dateien
   * löschen kann – dasselbe Muster wie beim Video.
   *
   * Die Schlüssel müssen **vor** dem Delete gesammelt werden: Danach sind die
   * Zeilen weg, und die Dateien wären erst nach der 24-Stunden-Karenz des
   * täglichen Aufräumers verschwunden. Genau so stand es hier lange nur im
   * Kommentar – gelöscht hat der Aufrufer nie.
   */
  async remove(id: string): Promise<string[]> {
    const versionen = await this.db
      .select({
        id: videoVersions.id,
        originalKey: videoVersions.originalKey,
        proxyKey: videoVersions.proxyKey,
        posterKey: videoVersions.posterKey,
        spriteKey: videoVersions.spriteKey,
        hlsKey: videoVersions.hlsKey,
      })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .where(eq(videos.projectId, id));
    const dateien = await this.db
      .select({ storageKey: projectFiles.storageKey })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, id));

    const [row] = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');

    return [
      ...versionen.flatMap((v) => [
        v.originalKey,
        v.proxyKey,
        v.posterKey,
        v.spriteKey,
        v.hlsKey,
        // Erzeugte Download-Formate, je Fassung ein Verzeichnis (Phase 19).
        this.storage.keyForRenditionDir(v.id),
      ]),
      ...dateien.map((d) => d.storageKey),
    ].filter((key): key is string => Boolean(key));
  }

  /**
   * Projekt archivieren oder zurückholen (Phase 18).
   *
   * Archiviert heißt nicht gelöscht: Das Projekt bleibt sichtbar und
   * abspielbar, zeigt aber nur noch die neueste Fassung je Video, und
   * kommentiert wird nicht mehr. Die älteren Fassungen bleiben die
   * eingestellte Frist lang liegen – falls es ein Irrtum war – und werden
   * danach vom täglichen Aufräumer entfernt.
   */
  async setArchived(id: string, archived: boolean, scope: AccessScope): Promise<ProjectDto> {
    const [row] = await this.db
      .update(projects)
      // Beim Zurückholen wird das Datum gelöscht: Die Frist beginnt bei einem
      // erneuten Archivieren von vorn, sonst wäre alles sofort weg.
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    this.logger.log(`Projekt ${id} ${archived ? 'archiviert' : 'zurückgeholt'}.`);
    return this.findOneOrFail(row.id, scope);
  }

  /** Ist dieses Projekt archiviert? Kurze Auskunft für die Rechteprüfungen. */
  async isArchived(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return Boolean(row?.archivedAt);
  }

  /** Ein Schreibzugriff im Projekt hebt es in der Liste nach oben. */
  async touch(id: string): Promise<void> {
    await this.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
  }

  private toDto(row: ProjectQueryRow, scope: AccessScope): ProjectDto {
    return {
      id: row.project.id,
      name: row.project.name,
      customer: row.project.customer,
      description: row.project.description,
      createdAt: row.project.createdAt.toISOString(),
      updatedAt: row.project.updatedAt.toISOString(),
      createdBy:
        row.creatorId && row.creatorName && row.creatorEmail
          ? {
              id: row.creatorId,
              name: row.creatorName,
              email: row.creatorEmail,
              role: row.creatorRole ?? 'GUEST',
            }
          : null,
      archivedAt: row.project.archivedAt?.toISOString() ?? null,
      videoCount: row.videoCount,
      fileCount: row.fileCount,
      canUploadFiles: this.accessService.canUpload(scope, row.project.id),
      tags: (row.tags ?? []).map(toTagRef),
      fields: row.fields ?? [],
    };
  }
}

/** Ohne gespeicherte Farbe wird sie aus dem Namen abgeleitet. */
export function toTagRef(tag: { id: string; name: string; color: string | null }): TagRefDto {
  return { id: tag.id, name: tag.name, color: tag.color ?? colorForTagName(tag.name) };
}
