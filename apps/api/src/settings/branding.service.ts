/**
 * White-Label pro Workspace (Phase 10).
 *
 * Ein Container, ein Workspace, ein Erscheinungsbild – kein Mandantenmodell.
 * Titel, Farbe und Logo liegen deshalb in derselben einen Einstellungszeile
 * wie der Mailversand.
 */
import { BadRequestException, Inject, Injectable, Logger, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { BrandingDto, LogoMimeType } from '@klappe/shared';
import {
  DEFAULT_BRAND_ACCENT,
  LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  deriveBrandColors,
  normalizeBrandTitle,
  normalizeHexColor,
} from '@klappe/shared';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { appSettings } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { SettingsService } from './settings.service';

const EXTENSIONS: Record<LogoMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

const SETTINGS_ID = 1;

export interface UpdateBrandingInput {
  title?: string | null;
  accent?: string | null;
}

@Injectable()
export class BrandingService {
  private readonly logger = new Logger(BrandingService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settingsService: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Ohne Anmeldung abrufbar: Die Anmeldeseite und das Gast-Gatter sollen das
   * Erscheinungsbild schon zeigen, bevor jemand angemeldet ist.
   */
  async get(): Promise<BrandingDto> {
    const row = await this.settingsService.getRow();
    const colors = deriveBrandColors(row.brandAccent);

    return {
      title: normalizeBrandTitle(row.brandTitle),
      ...colors,
      // Der Zeitstempel im Pfad sorgt dafür, dass ein neues Logo sofort
      // erscheint und nicht bis zum Ablauf des Browser-Caches das alte bleibt.
      logoUrl: row.brandLogoKey
        ? `/v1/branding/logo?v=${row.brandLogoUpdatedAt?.getTime() ?? 0}`
        : null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(input: UpdateBrandingInput): Promise<BrandingDto> {
    await this.settingsService.getRow();

    let accent: string | null | undefined;
    if (input.accent !== undefined) {
      if (input.accent === null || input.accent.trim() === '') {
        accent = null;
      } else {
        const normalized = normalizeHexColor(input.accent);
        if (!normalized) {
          throw new BadRequestException(
            `„${input.accent}" ist keine Farbe. Erwartet wird eine Hex-Angabe wie ${DEFAULT_BRAND_ACCENT}.`,
          );
        }
        accent = normalized;
      }
    }

    await this.db
      .update(appSettings)
      .set({
        brandTitle: input.title === undefined ? undefined : input.title?.trim() || null,
        brandAccent: accent,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  /**
   * Logo ersetzen. Bewusst als roher Datenstrom statt als Formular-Upload:
   * Es geht um eine einzelne kleine Datei, und der Server kommt so ohne
   * zusätzliche Formularbibliothek aus.
   */
  async setLogo(data: Buffer, mimeType: string): Promise<BrandingDto> {
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

    const row = await this.settingsService.getRow();
    const key = this.storage.keyForBrandLogo(EXTENSIONS[type]);
    await this.storage.writeFile(key, data);

    // Ein Formatwechsel lässt die alte Datei sonst verwaist zurück.
    if (row.brandLogoKey && row.brandLogoKey !== key) {
      await this.storage.remove(row.brandLogoKey);
    }

    await this.db
      .update(appSettings)
      .set({
        brandLogoKey: key,
        brandLogoMime: type,
        brandLogoUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    this.logger.log(`Logo ersetzt (${type}, ${data.length} Bytes).`);
    return this.get();
  }

  async removeLogo(): Promise<BrandingDto> {
    const row = await this.settingsService.getRow();
    if (row.brandLogoKey) await this.storage.remove(row.brandLogoKey);

    await this.db
      .update(appSettings)
      .set({
        brandLogoKey: null,
        brandLogoMime: null,
        brandLogoUpdatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  /** Datei und Typ des Logos – `null`, solange keines hinterlegt ist. */
  async getLogoFile(): Promise<{ key: string; mimeType: string } | null> {
    const row = await this.settingsService.getRow();
    if (!row.brandLogoKey) return null;
    if (!(await this.storage.exists(row.brandLogoKey))) return null;
    return { key: row.brandLogoKey, mimeType: row.brandLogoMime ?? 'application/octet-stream' };
  }
}
