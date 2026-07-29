import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { CustomerDto, ProjectDto } from '@klappe/shared';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { StorageService } from '../storage/storage.service';
import { ProjectFieldsService } from './project-fields.service';
import {
  CreateProjectDto,
  RenameCustomerDto,
  SetFieldValuesDto,
  UpdateProjectDto,
} from './projects.dto';
import { ProjectsService } from './projects.service';

@Controller('v1/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
    private readonly projectFieldsService: ProjectFieldsService,
  ) {}

  /**
   * Liste mit Filter und Sortierung (Phase 12).
   *
   * `tags` ist eine Komma-Liste von IDs, `tagMatch=all` verlangt sämtliche
   * davon statt nur eines. Unbekannte Werte werden still übergangen – ein
   * Filter soll keine Fehlermeldung erzeugen, sondern eine Liste.
   */
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('tags') tags?: string,
    @Query('tagMatch') tagMatch?: string,
    @Query('sort') sort?: string,
    @Query('customer') customer?: string | string[],
    @Query('field') field?: string | string[],
  ): Promise<ProjectDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.list(scope, {
      tagIds: parseIdList(tags),
      tagMatch: tagMatch === 'all' ? 'all' : 'any',
      sort: parseSort(sort),
      customers: alsListe(customer)
        .map((eintrag) => eintrag.trim())
        .filter(Boolean),
      fieldFilters: parseFieldFilters(alsListe(field)),
    });
  }

  /**
   * Muss **vor** `GET :id` stehen, sonst versucht die UUID-Pipe, das Wort
   * „customers" als Projekt-ID zu lesen.
   */
  @Get('customers')
  async listCustomers(@CurrentUser() user: RequestUser): Promise<CustomerDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.listCustomers(scope);
  }

  /** Kunden umbenennen oder – ohne `nach` – von allen Projekten entfernen. */
  @Roles('ADMIN', 'MEMBER')
  @Patch('customers')
  async renameCustomer(@Body() dto: RenameCustomerDto): Promise<{ projectCount: number }> {
    const projectCount = await this.projectsService.renameCustomer(
      dto.von.trim(),
      dto.nach?.trim() || null,
    );
    return { projectCount };
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.findOneOrFail(id, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Post()
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.create(dto, user, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.update(id, dto, scope);
  }

  /** Alle Feldwerte des Projekts in einem Rutsch; leere Werte löschen. */
  @Roles('ADMIN', 'MEMBER')
  @Put(':id/fields')
  async setFieldValues(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetFieldValuesDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    await this.projectFieldsService.setValues(id, dto.values);
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.findOneOrFail(id, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    const keys = await this.projectsService.remove(id);
    for (const key of keys) {
      await this.storage.remove(key);
    }
    // Der leere Projektordner der Kunden-Dateien soll nicht liegen bleiben.
    await this.storage.remove(this.storage.keyForProjectFilesDir(id));
  }
}

/** Ein wiederholter Query-Parameter kommt mal einzeln, mal als Feld an. */
function alsListe(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

const uuidForm = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Auch `field:<uuid>` ist eine gültige Sortierung (Phase 16). */
function parseSort(
  sort: string | undefined,
): 'updated' | 'created' | 'name' | 'customer' | `field:${string}` {
  if (sort === 'name' || sort === 'created' || sort === 'customer') return sort;
  if (sort?.startsWith('field:') && uuidForm.test(sort.slice('field:'.length))) {
    return sort as `field:${string}`;
  }
  return 'updated';
}

/**
 * `field=<uuid>:<wert>`, beliebig oft wiederholt. Mehrere Werte desselben
 * Felds sammeln sich zu einer Oder-Gruppe; Unfug fällt still heraus – ein
 * Filter soll eine Liste erzeugen, keine Fehlermeldung.
 */
function parseFieldFilters(eintraege: string[]): { fieldId: string; values: string[] }[] {
  const gruppen = new Map<string, string[]>();
  for (const eintrag of eintraege) {
    const trenner = eintrag.indexOf(':');
    if (trenner <= 0) continue;
    const fieldId = eintrag.slice(0, trenner);
    const wert = eintrag.slice(trenner + 1).trim();
    if (!uuidForm.test(fieldId) || !wert) continue;
    const liste = gruppen.get(fieldId) ?? [];
    liste.push(wert);
    gruppen.set(fieldId, liste);
  }
  return [...gruppen.entries()].map(([fieldId, values]) => ({ fieldId, values }));
}

/** `"a,b , c"` → `['a','b','c']`, ohne Leeres und ohne Unfug. */
function parseIdList(value: string | undefined): string[] {
  if (!value) return [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => uuid.test(entry));
}
