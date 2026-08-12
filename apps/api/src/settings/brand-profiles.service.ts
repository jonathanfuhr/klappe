/**
 * Auftritte: fremde Erscheinungsbilder pro Projekt (1.6).
 *
 * Bis 1.5 gab es genau ein Erscheinungsbild je Container. Geht ein Film aber
 * über eine Agentur zum Endkunden, ist die Agentur der Absender – und der
 * Kunde saß bis dahin vor unserem Logo.
 *
 * Kein Mandantenmodell: Daten, Benutzer und Rechte bleiben, wie sie sind.
 * Getauscht wird allein, was man sieht.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { BrandProfileDto, BrandProfileRefDto, LogoMimeType } from '@klappe/shared';
import {
  LOGO_MIME_TYPES,
  MAX_COMPANY_NAME_LENGTH,
  MAX_COMPANY_SHORT_LENGTH,
  MAX_LOGO_BYTES,
  brandProfileColors,
  normalizeBrandProfileName,
  normalizeCompanyText,
  normalizeHexColor,
  normalizeMailFromName,
  toBrandProfileRef,
} from '@klappe/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { brandProfiles, projects } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from './settings.service';

const EXTENSIONS: Record<LogoMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export interface BrandProfileInput {
  name?: string | null;
  accent?: string | null;
  companyName?: string | null;
  companyShort?: string | null;
  mailFromName?: string | null;
}

/** Eine Zeile aus `brand_profiles`, so wie sie aus der Datenbank kommt. */
type Zeile = typeof brandProfiles.$inferSelect;

@Injectable()
export class BrandProfilesService {
  private readonly logger = new Logger(BrandProfilesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settingsService: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Alle Auftritte, alphabetisch, mit der Zahl der Projekte, an denen sie
   * hängen. Die Zahl steht in der Verwaltung, weil eine Änderung am Auftritt
   * alle diese Projekte zugleich trifft – auch die längst abgeschlossenen.
   */
  async list(): Promise<BrandProfileDto[]> {
    const zeilen = await this.db
      .select({
        profil: brandProfiles,
        projectCount: sql<number>`count(${projects.id})::int`,
      })
      .from(brandProfiles)
      .leftJoin(projects, eq(projects.brandProfileId, brandProfiles.id))
      .groupBy(brandProfiles.id)
      .orderBy(asc(brandProfiles.name));

    const grundfarbe = await this.grundfarbe();
    return zeilen.map((zeile) => this.toDto(zeile.profil, grundfarbe, zeile.projectCount));
  }

  /** Ein einzelner Auftritt – `null`, wenn es ihn nicht (mehr) gibt. */
  async find(id: string): Promise<BrandProfileDto | null> {
    const [zeile] = await this.db.select().from(brandProfiles).where(eq(brandProfiles.id, id));
    if (!zeile) return null;
    return this.toDto(zeile, await this.grundfarbe(), await this.projektzahl(id));
  }

  /**
   * Der Auftritt eines Projekts – `null`, wenn das Projekt beim eigenen
   * Erscheinungsbild bleibt. Das ist der Normalfall und darf nichts kosten:
   * eine Abfrage, kein Join über die ganze Projektliste.
   *
   * Liefert nur die Anzeige-Felder: Das Ergebnis geht auch an Gäste.
   */
  async forProject(projectId: string): Promise<BrandProfileRefDto | null> {
    const [zeile] = await this.db
      .select({ profil: brandProfiles })
      .from(projects)
      .innerJoin(brandProfiles, eq(projects.brandProfileId, brandProfiles.id))
      .where(eq(projects.id, projectId));

    if (!zeile) return null;
    return toBrandProfileRef(this.toDto(zeile.profil, await this.grundfarbe(), 0));
  }

  /**
   * Wie `forProject`, aber mit den Verwaltungsfeldern – für den Mailversand,
   * der den Absendernamen braucht. Verlässt den Server nie: Was an Gäste
   * geht, ist immer die knappe Fassung aus `forProject`.
   */
  async fullForProject(projectId: string): Promise<BrandProfileDto | null> {
    const [zeile] = await this.db
      .select({ profil: brandProfiles })
      .from(projects)
      .innerJoin(brandProfiles, eq(projects.brandProfileId, brandProfiles.id))
      .where(eq(projects.id, projectId));

    if (!zeile) return null;
    return this.toDto(zeile.profil, await this.grundfarbe(), 0);
  }

  /**
   * Die Auftritte mehrerer Projekte auf einmal – für Listen, damit nicht je
   * Zeile eine eigene Abfrage läuft. Projekte ohne Auftritt fehlen in der
   * Karte; das ist der Normalfall.
   */
  async forProjects(projectIds: string[]): Promise<Map<string, BrandProfileRefDto>> {
    const karte = new Map<string, BrandProfileRefDto>();
    if (projectIds.length === 0) return karte;

    const zeilen = await this.db
      .select({ projectId: projects.id, profil: brandProfiles })
      .from(projects)
      .innerJoin(brandProfiles, eq(projects.brandProfileId, brandProfiles.id))
      .where(inArray(projects.id, projectIds));

    const grundfarbe = await this.grundfarbe();
    for (const zeile of zeilen) {
      karte.set(zeile.projectId, toBrandProfileRef(this.toDto(zeile.profil, grundfarbe, 0)));
    }
    return karte;
  }

  async create(input: BrandProfileInput): Promise<BrandProfileDto> {
    const name = normalizeBrandProfileName(input.name);
    if (!name) throw new BadRequestException('Ein Auftritt braucht einen Namen.');

    const [zeile] = await this.db
      .insert(brandProfiles)
      .values({
        name,
        accent: this.pruefeFarbe(input.accent) ?? null,
        companyName: normalizeCompanyText(input.companyName, MAX_COMPANY_NAME_LENGTH),
        companyShort: normalizeCompanyText(input.companyShort, MAX_COMPANY_SHORT_LENGTH),
        mailFromName: normalizeMailFromName(input.mailFromName),
      })
      .returning();

    this.logger.log(`Auftritt „${name}" angelegt.`);
    return this.toDto(zeile, await this.grundfarbe(), 0);
  }

  async update(id: string, input: BrandProfileInput): Promise<BrandProfileDto> {
    await this.holeZeile(id);

    // Ein leerer Name würde den Auftritt in der Auswahl unauffindbar machen;
    // die anderen Felder dürfen sehr wohl geleert werden.
    let name: string | undefined;
    if (input.name !== undefined) {
      const sauber = normalizeBrandProfileName(input.name);
      if (!sauber) throw new BadRequestException('Ein Auftritt braucht einen Namen.');
      name = sauber;
    }

    await this.db
      .update(brandProfiles)
      .set({
        name,
        accent: input.accent === undefined ? undefined : (this.pruefeFarbe(input.accent) ?? null),
        companyName:
          input.companyName === undefined
            ? undefined
            : normalizeCompanyText(input.companyName, MAX_COMPANY_NAME_LENGTH),
        companyShort:
          input.companyShort === undefined
            ? undefined
            : normalizeCompanyText(input.companyShort, MAX_COMPANY_SHORT_LENGTH),
        mailFromName:
          input.mailFromName === undefined ? undefined : normalizeMailFromName(input.mailFromName),
        updatedAt: new Date(),
      })
      .where(eq(brandProfiles.id, id));

    const dto = await this.find(id);
    if (!dto) throw new NotFoundException('Diesen Auftritt gibt es nicht.');
    return dto;
  }

  /**
   * Logo eines Auftritts. Wie beim Workspace rohe Bytes im Rumpf – es geht um
   * eine einzelne kleine Datei.
   */
  async setLogo(id: string, data: Buffer, mimeType: string): Promise<BrandProfileDto> {
    const zeile = await this.holeZeile(id);

    const type = mimeType.split(';')[0].trim().toLowerCase() as LogoMimeType;
    if (!LOGO_MIME_TYPES.includes(type)) {
      throw new UnsupportedMediaTypeException(
        `Als Logo gehen ${LOGO_MIME_TYPES.join(', ')} – nicht ${mimeType}.`,
      );
    }
    if (data.length === 0) throw new BadRequestException('Die Datei ist leer.');
    if (data.length > MAX_LOGO_BYTES) {
      throw new PayloadTooLargeException(
        `Das Logo darf höchstens ${Math.round(MAX_LOGO_BYTES / 1024)} KB groß sein.`,
      );
    }

    const key = this.storage.keyForBrandProfileLogo(id, EXTENSIONS[type]);
    await this.storage.writeFile(key, data);

    // Ein Formatwechsel lässt die alte Datei sonst verwaist zurück.
    if (zeile.logoKey && zeile.logoKey !== key) await this.storage.remove(zeile.logoKey);

    await this.db
      .update(brandProfiles)
      .set({ logoKey: key, logoMime: type, logoUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(brandProfiles.id, id));

    this.logger.log(`Logo für Auftritt „${zeile.name}" ersetzt (${type}, ${data.length} Bytes).`);
    const dto = await this.find(id);
    if (!dto) throw new NotFoundException('Diesen Auftritt gibt es nicht.');
    return dto;
  }

  async removeLogo(id: string): Promise<BrandProfileDto> {
    const zeile = await this.holeZeile(id);
    if (zeile.logoKey) await this.storage.remove(zeile.logoKey);

    await this.db
      .update(brandProfiles)
      .set({ logoKey: null, logoMime: null, logoUpdatedAt: null, updatedAt: new Date() })
      .where(eq(brandProfiles.id, id));

    const dto = await this.find(id);
    if (!dto) throw new NotFoundException('Diesen Auftritt gibt es nicht.');
    return dto;
  }

  /** Datei und Typ des Logos – `null`, solange keines hinterlegt ist. */
  async getLogoFile(id: string): Promise<{ key: string; mimeType: string } | null> {
    const [zeile] = await this.db.select().from(brandProfiles).where(eq(brandProfiles.id, id));
    if (!zeile?.logoKey) return null;
    if (!(await this.storage.exists(zeile.logoKey))) return null;
    return { key: zeile.logoKey, mimeType: zeile.logoMime ?? 'application/octet-stream' };
  }

  /**
   * Auftritt eines Projekts setzen oder abnehmen (`null`). Ein unbekannter
   * Auftritt wird abgewiesen, statt still `null` zu setzen – sonst stünde das
   * Projekt plötzlich wieder unter unserem Logo, ohne dass jemand es merkt.
   */
  async assignToProject(projectId: string, profileId: string | null): Promise<BrandProfileDto | null> {
    if (profileId) await this.holeZeile(profileId);

    const [projekt] = await this.db
      .update(projects)
      .set({ brandProfileId: profileId, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });

    if (!projekt) throw new NotFoundException('Dieses Projekt gibt es nicht.');
    return profileId ? this.find(profileId) : null;
  }

  private async holeZeile(id: string): Promise<Zeile> {
    const [zeile] = await this.db.select().from(brandProfiles).where(eq(brandProfiles.id, id));
    if (!zeile) throw new NotFoundException('Diesen Auftritt gibt es nicht.');
    return zeile;
  }

  private async projektzahl(id: string): Promise<number> {
    const [zeile] = await this.db
      .select({ anzahl: sql<number>`count(*)::int` })
      .from(projects)
      .where(eq(projects.brandProfileId, id));
    return zeile?.anzahl ?? 0;
  }

  /**
   * Die Farbe des Hauses – Rückfall für Auftritte ohne eigene. Ein Auftritt
   * ohne Farbangabe soll nicht farblos dastehen.
   */
  private async grundfarbe(): Promise<string | null> {
    try {
      const row = await this.settingsService.getRow();
      return row.brandAccent;
    } catch (error) {
      // Wie beim Workspace-Branding: Eine nicht ladbare Einstellung ist kein
      // Grund, die Seite nicht anzuzeigen.
      this.logger.warn(`Grundfarbe nicht ladbar, nehme den Standard: ${String(error)}`);
      return null;
    }
  }

  private pruefeFarbe(accent: string | null | undefined): string | null | undefined {
    if (accent === undefined) return undefined;
    if (accent === null || accent.trim() === '') return null;

    const normalized = normalizeHexColor(accent);
    if (!normalized) {
      throw new BadRequestException(
        `„${accent}" ist keine Farbe. Erwartet wird eine Hex-Angabe wie #4c8dff.`,
      );
    }
    return normalized;
  }

  private toDto(zeile: Zeile, grundfarbe: string | null, projectCount: number): BrandProfileDto {
    return {
      id: zeile.id,
      name: zeile.name,
      ...brandProfileColors(zeile.accent, grundfarbe),
      // Der Zeitstempel im Pfad sorgt dafür, dass ein neues Logo sofort
      // erscheint und nicht bis zum Ablauf des Browser-Caches das alte bleibt.
      logoUrl: zeile.logoKey
        ? `/v1/brand-profiles/${zeile.id}/logo?v=${zeile.logoUpdatedAt?.getTime() ?? 0}`
        : null,
      companyName: zeile.companyName,
      companyShort: zeile.companyShort,
      mailFromName: zeile.mailFromName,
      projectCount,
      updatedAt: zeile.updatedAt.toISOString(),
    };
  }
}
