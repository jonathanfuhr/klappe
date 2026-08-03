/**
 * Die Bedienoberfläche der awork-Anbindung (Phase 30): Einstellungen für den
 * Admin, Zuordnung je Projekt fürs Team.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  AWORK_EVENTS,
  type AworkCheckDto,
  type AworkEvent,
  type AworkFieldDto,
  type AworkProjectDto,
  type AworkProjectLinkDto,
  type AworkProjectStateDto,
  type AworkSettingsDto,
  MAX_AWORK_TASK_LIST_NAME,
  MAX_AWORK_TASK_TITLE_PREFIX,
} from '@klappe/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { eq, sql } from 'drizzle-orm';
import { Roles } from '../auth/auth.decorators';
import { DB, type Database } from '../db/db.module';
import { aworkTasks, videoVersions, videos } from '../db/schema';
import { AworkClient, AworkError } from './awork.client';
import { AworkLinksService } from './awork-links.service';
import { AworkSettingsService } from './awork-settings.service';

class AworkEventDto {
  @IsIn(AWORK_EVENTS)
  event!: AworkEvent;

  @IsBoolean()
  enabled!: boolean;
}

class UpdateAworkDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Leer lassen heißt „unverändert"; ein leerer String löscht den Schlüssel. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiKey?: string;

  @IsOptional()
  @IsUUID()
  projectNumberFieldId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  aworkProjectNumberFieldId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AWORK_TASK_LIST_NAME)
  taskListName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AWORK_TASK_TITLE_PREFIX)
  taskTitlePrefix?: string;

  @IsOptional()
  @IsUUID()
  fallbackUserId?: string | null;

  @IsOptional()
  @IsBoolean()
  autoCreateProjects?: boolean;

  @IsOptional()
  @IsBoolean()
  writeBackLink?: boolean;

  @IsOptional()
  @IsBoolean()
  syncProjectNumber?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AworkEventDto)
  events?: AworkEventDto[];
}

class CheckAworkDto {
  /** Ohne Angabe wird der gespeicherte Schlüssel geprüft. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  apiKey?: string;
}

class LinkProjectDto {
  @IsString()
  @MaxLength(64)
  aworkProjectId!: string;
}

@Controller('v1')
export class AworkController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: AworkSettingsService,
    private readonly client: AworkClient,
    private readonly links: AworkLinksService,
  ) {}

  // ---------------------------------------------------------- Einstellungen

  @Roles('ADMIN')
  @Get('settings/awork')
  get(): Promise<AworkSettingsDto> {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Put('settings/awork')
  update(@Body() dto: UpdateAworkDto): Promise<AworkSettingsDto> {
    return this.settings.update({
      enabled: dto.enabled,
      // Ein weggelassenes Feld lässt den gespeicherten Schlüssel in Ruhe.
      apiKey: dto.apiKey === undefined ? undefined : dto.apiKey || null,
      projectNumberFieldId: dto.projectNumberFieldId,
      aworkProjectNumberFieldId: dto.aworkProjectNumberFieldId,
      taskListName: dto.taskListName,
      taskTitlePrefix: dto.taskTitlePrefix,
      fallbackUserId: dto.fallbackUserId,
      autoCreateProjects: dto.autoCreateProjects,
      writeBackLink: dto.writeBackLink,
      syncProjectNumber: dto.syncProjectNumber,
      events: dto.events,
    });
  }

  /**
   * Verbindungstest. Nimmt wahlweise einen noch nicht gespeicherten Schlüssel
   * entgegen – sonst müsste man erst speichern, um zu erfahren, ob er stimmt.
   */
  @Roles('ADMIN')
  @Post('settings/awork/pruefen')
  @HttpCode(200)
  async check(@Body() dto: CheckAworkDto): Promise<AworkCheckDto> {
    const key = dto.apiKey || (await this.settings.apiKeyForCheck());
    if (!key) {
      return {
        ok: false,
        message: 'Es ist kein API-Schlüssel hinterlegt.',
        userCount: null,
        projectCount: null,
      };
    }

    try {
      const ergebnis = await this.client.check(key);
      await this.settings.merkeErgebnis(null);
      return {
        ok: true,
        message: `Verbindung steht: ${ergebnis.userCount} Nutzer, ${ergebnis.projectCount} Projekte gefunden.`,
        userCount: ergebnis.userCount,
        projectCount: ergebnis.projectCount,
      };
    } catch (error) {
      const meldung = error instanceof AworkError ? error.message : String(error);
      await this.settings.merkeErgebnis(meldung);
      return { ok: false, message: meldung, userCount: null, projectCount: null };
    }
  }

  /** Die Freifelder aus awork – zur Auswahl, welches die Projektnummer trägt. */
  @Roles('ADMIN')
  @Get('settings/awork/felder')
  async fields(): Promise<AworkFieldDto[]> {
    const felder = await this.client.listCustomFieldDefinitions();
    return felder
      .filter((feld) => feld.entity === 'project')
      .map((feld) => ({ id: feld.id, name: feld.name, type: feld.type }));
  }

  // ------------------------------------------------------ Zuordnung je Projekt

  /** Die awork-Projekte zur Auswahl in der manuellen Zuordnung. */
  @Roles('ADMIN', 'MEMBER')
  @Get('awork/projekte')
  async projects(): Promise<AworkProjectDto[]> {
    const kandidaten = await this.links.kandidaten();
    return kandidaten.map((eintrag) => ({
      id: eintrag.id,
      name: eintrag.name,
      company: eintrag.companyName,
      projectNumber: eintrag.projectNumber,
    }));
  }

  @Roles('ADMIN', 'MEMBER')
  @Get('projects/:id/awork')
  async projectState(
    @Param('id', new ParseUUIDPipe()) projectId: string,
  ): Promise<AworkProjectStateDto> {
    const enabled = await this.settings.isReady();
    const [link, projectNumber, aufgaben] = await Promise.all([
      this.links.linkFor(projectId),
      this.links.projektnummer(projectId),
      this.db
        .select({ anzahl: sql<number>`count(*)::int` })
        .from(aworkTasks)
        .innerJoin(videoVersions, eq(aworkTasks.versionId, videoVersions.id))
        .innerJoin(videos, eq(videoVersions.videoId, videos.id))
        .where(eq(videos.projectId, projectId)),
    ]);

    return {
      enabled,
      link,
      projectNumber,
      taskCount: aufgaben[0]?.anzahl ?? 0,
    };
  }

  /**
   * Von Hand zuordnen. Der Weg für die Fälle, die die Projektnummer nicht
   * löst – ein Altprojekt ohne Nummer etwa, oder zwei Projekte, die dieselbe
   * tragen.
   */
  @Roles('ADMIN', 'MEMBER')
  @Put('projects/:id/awork')
  async link(
    @Param('id', new ParseUUIDPipe()) projectId: string,
    @Body() dto: LinkProjectDto,
  ): Promise<AworkProjectLinkDto> {
    const projekt = await this.client.getProject(dto.aworkProjectId);
    if (!projekt) throw new BadRequestException('Dieses Projekt gibt es in awork nicht.');

    const belegt = await this.links.linkForAworkProject(dto.aworkProjectId);
    if (belegt && belegt.projectId !== projectId) {
      throw new BadRequestException(
        'Dieses awork-Projekt ist bereits einem anderen Klappe-Projekt zugeordnet.',
      );
    }
    return this.links.speichere(projectId, projekt.id, projekt.name, 'manuell');
  }

  /**
   * Zuordnung suchen lassen. Sagt im Fehlerfall, **warum** nichts gefunden
   * wurde – „geht nicht" allein hilft niemandem beim Nachbessern.
   */
  @Roles('ADMIN', 'MEMBER')
  @Post('projects/:id/awork/zuordnen')
  @HttpCode(200)
  async resolve(
    @Param('id', new ParseUUIDPipe()) projectId: string,
  ): Promise<AworkProjectLinkDto> {
    const ergebnis = await this.links.resolve(projectId);
    if (ergebnis.art === 'verknuepft') return ergebnis.link;

    const grund = ergebnis.grund;
    throw new BadRequestException(
      grund.art === 'ohne-nummer'
        ? 'Dieses Projekt hat keine Projektnummer – ohne sie lässt sich das Gegenstück nicht finden.'
        : grund.art === 'kein-treffer'
          ? `In awork gibt es kein Projekt mit der Nummer ${grund.nummer}.`
          : grund.art === 'mehrdeutig'
            ? `In awork tragen ${grund.kandidaten.length} Projekte diese Nummer – bitte von Hand zuordnen.`
            : `Die Projektnummer passt, aber der Kunde nicht: hier „${grund.erwartet}", in awork „${grund.gefunden}". Bitte prüfen und von Hand zuordnen.`,
    );
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete('projects/:id/awork')
  @HttpCode(204)
  async unlink(@Param('id', new ParseUUIDPipe()) projectId: string): Promise<void> {
    await this.links.entferne(projectId);
  }
}
