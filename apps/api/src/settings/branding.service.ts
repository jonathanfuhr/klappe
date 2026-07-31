/**
 * White-Label pro Workspace (Phase 10).
 *
 * Ein Container, ein Workspace, ein Erscheinungsbild – kein Mandantenmodell.
 * Titel, Farbe und Logo liegen deshalb in derselben einen Einstellungszeile
 * wie der Mailversand.
 */
import { BadRequestException, Inject, Injectable, Logger, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { AppIconMimeType, BrandingDto, FaviconMimeType, LogoMimeType } from '@klappe/shared';
import {
  APP_ICON_MIME_TYPES,
  DEFAULT_BRAND_ACCENT,
  DEFAULT_LOCALE,
  FAVICON_MIME_TYPES,
  LOGO_MIME_TYPES,
  MAX_APP_ICON_BYTES,
  MAX_COMPANY_NAME_LENGTH,
  MAX_COMPANY_SHORT_LENGTH,
  MAX_FAVICON_BYTES,
  MAX_LOGO_BYTES,
  deriveBrandColors,
  isLocale,
  normalizeBrandTitle,
  normalizeCompanyText,
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

const FAVICON_EXTENSIONS: Record<FaviconMimeType, string> = {
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

const SETTINGS_ID = 1;

/** Die acht Bytes, mit denen jede PNG-Datei anfängt. */
const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface UpdateBrandingInput {
  title?: string | null;
  /** Sprache des Workspace (Phase 26). */
  defaultLocale?: string;
  accent?: string | null;
  companyName?: string | null;
  companyShort?: string | null;
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

    // Der Zeitstempel im Pfad sorgt dafür, dass ein neues Logo sofort
    // erscheint und nicht bis zum Ablauf des Browser-Caches das alte bleibt.
    const logoUrl = row.brandLogoKey
      ? `/v1/branding/logo?v=${row.brandLogoUpdatedAt?.getTime() ?? 0}`
      : null;

    return {
      title: normalizeBrandTitle(row.brandTitle),
      // Sprache des Workspace (Phase 26); Unsinn in der Spalte gilt als Deutsch.
      defaultLocale: isLocale(row.defaultLocale) ? row.defaultLocale : DEFAULT_LOCALE,
      ...colors,
      logoUrl,
      /*
       * Beide Symbole werden fertig hochgeladen (Phase 24). `null` heißt
       * schlicht: Es ist keines hinterlegt, es bleibt beim mitgelieferten
       * Klappe-Zeichen.
       */
      faviconUrl: row.faviconKey
        ? `/v1/branding/favicon?v=${row.faviconUpdatedAt?.getTime() ?? 0}`
        : null,
      appIconUrl: row.appIconKey
        ? `/v1/branding/app-icon.png?v=${row.appIconUpdatedAt?.getTime() ?? 0}`
        : null,
      companyName: normalizeCompanyText(row.companyName, MAX_COMPANY_NAME_LENGTH),
      companyShort: normalizeCompanyText(row.companyShort, MAX_COMPANY_SHORT_LENGTH),
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
        defaultLocale: isLocale(input.defaultLocale) ? input.defaultLocale : undefined,
        brandAccent: accent,
        companyName:
          input.companyName === undefined
            ? undefined
            : normalizeCompanyText(input.companyName, MAX_COMPANY_NAME_LENGTH),
        companyShort:
          input.companyShort === undefined
            ? undefined
            : normalizeCompanyText(input.companyShort, MAX_COMPANY_SHORT_LENGTH),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  /**
   * Tab-Symbol hochladen. Wie beim Logo rohe Bytes im Rumpf.
   *
   * Nur `.ico`: Das nimmt jeder Browser im Tab an, und eine einzige Datei trägt
   * alle nötigen Größen zugleich. Erzeugt wird sie außerhalb – Klappe rechnet
   * seit Phase 24 nichts mehr selbst um.
   */
  async setFavicon(data: Buffer, mimeType: string): Promise<BrandingDto> {
    const type = mimeType.split(';')[0].trim().toLowerCase() as FaviconMimeType;
    if (!FAVICON_MIME_TYPES.includes(type)) {
      throw new UnsupportedMediaTypeException(
        `Als Tab-Symbol gehen ${FAVICON_MIME_TYPES.join(', ')} – nicht ${mimeType}.`,
      );
    }
    if (data.length === 0) throw new BadRequestException('Die Datei ist leer.');
    if (data.length > MAX_FAVICON_BYTES) {
      throw new PayloadTooLargeException(
        `Das Tab-Symbol darf höchstens ${Math.round(MAX_FAVICON_BYTES / 1024)} KB groß sein.`,
      );
    }

    const row = await this.settingsService.getRow();
    const key = this.storage.keyForFavicon(FAVICON_EXTENSIONS[type]);
    await this.storage.writeFile(key, data);

    // Ein Formatwechsel lässt die alte Datei sonst verwaist zurück.
    if (row.faviconKey && row.faviconKey !== key) {
      await this.storage.remove(row.faviconKey);
    }

    await this.db
      .update(appSettings)
      .set({
        faviconKey: key,
        faviconMime: type,
        faviconUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    this.logger.log(`Tab-Symbol ersetzt (${type}, ${data.length} Bytes).`);
    return this.get();
  }

  async removeFavicon(): Promise<BrandingDto> {
    const row = await this.settingsService.getRow();
    if (row.faviconKey) await this.storage.remove(row.faviconKey);

    await this.db
      .update(appSettings)
      .set({
        faviconKey: null,
        faviconMime: null,
        faviconUpdatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  /** Datei und Typ des eigenen Tab-Symbols – `null`, solange keines da ist. */
  async getFaviconFile(): Promise<{ key: string; mimeType: string } | null> {
    const row = await this.settingsService.getRow();
    if (!row.faviconKey) return null;
    if (!(await this.storage.exists(row.faviconKey))) return null;
    return { key: row.faviconKey, mimeType: row.faviconMime ?? 'application/octet-stream' };
  }

  /**
   * App-Symbol hochladen (Phase 24) – ein fertiges, quadratisches PNG für den
   * iOS-Startbildschirm und das Web-App-Manifest.
   *
   * Nur PNG, und das wird an der Signatur nachgeprüft statt am `Content-Type`:
   * Was hier hereinkommt, geht später als `image/png` wieder hinaus, und der
   * Endpunkt ist erreichbar – auf die Angabe des Absenders ist da kein Verlass.
   */
  async setAppIcon(data: Buffer, mimeType: string): Promise<BrandingDto> {
    const type = mimeType.split(';')[0].trim().toLowerCase();
    if (!APP_ICON_MIME_TYPES.includes(type as AppIconMimeType)) {
      throw new UnsupportedMediaTypeException(`Als App-Symbol geht nur PNG – nicht ${mimeType}.`);
    }
    if (data.length === 0) throw new BadRequestException('Die Datei ist leer.');
    if (data.length > MAX_APP_ICON_BYTES) {
      throw new PayloadTooLargeException(
        `Das App-Symbol darf höchstens ${Math.round(MAX_APP_ICON_BYTES / 1024)} KB groß sein.`,
      );
    }
    if (!data.subarray(0, 8).equals(PNG_SIGNATUR)) {
      throw new UnsupportedMediaTypeException('Die Datei ist kein PNG.');
    }

    await this.settingsService.getRow();
    const key = this.storage.keyForAppIcon();
    await this.storage.writeFile(key, data);

    await this.db
      .update(appSettings)
      .set({ appIconKey: key, appIconUpdatedAt: new Date(), updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));

    this.logger.log(`App-Symbol ersetzt (${data.length} Bytes).`);
    return this.get();
  }

  async removeAppIcon(): Promise<BrandingDto> {
    const row = await this.settingsService.getRow();
    if (row.appIconKey) await this.storage.remove(row.appIconKey);

    await this.db
      .update(appSettings)
      .set({ appIconKey: null, appIconUpdatedAt: null, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  /** Datei des App-Symbols – `null`, solange keines da ist. */
  async getAppIconFile(): Promise<{ key: string } | null> {
    const row = await this.settingsService.getRow();
    if (!row.appIconKey) return null;
    if (!(await this.storage.exists(row.appIconKey))) return null;
    return { key: row.appIconKey };
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
