/**
 * Welche Anmeldewege sind erlaubt, und wie ist Microsoft 365 eingerichtet?
 * (Phase 11)
 *
 * Getrennt vom `SettingsService`, weil hier eine eigene Regel gilt: Man darf
 * sich nicht selbst aussperren.
 */
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthSettingsDto, LoginMethodsDto } from '@klappe/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { appSettings } from '../db/schema';
import { parseDomainList } from '../auth/microsoft/entra';
import { SettingsService } from './settings.service';

const SETTINGS_ID = 1;
const DEFAULT_BUTTON_LABEL = 'Mit Microsoft 365 anmelden';

/** Vollständige OIDC-Zugangsdaten inklusive Klartext-Secret – nur serverintern. */
export interface OidcCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface UpdateAuthSettingsInput {
  localLoginEnabled?: boolean;
  oidcEnabled?: boolean;
  tenantId?: string | null;
  clientId?: string | null;
  /** `undefined` = unverändert, `null` = löschen, sonst neues Secret. */
  clientSecret?: string | null;
  autoProvision?: boolean;
  allowedDomains?: string | null;
  buttonLabel?: string | null;
}

@Injectable()
export class AuthSettingsService {
  private readonly logger = new Logger(AuthSettingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly settingsService: SettingsService,
  ) {}

  /** Interne Sicht mit ausgewerteten Domänen, ohne Secret. */
  async getRaw(): Promise<{
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
    autoProvision: boolean;
    allowedDomains: string[];
  }> {
    const row = await this.settingsService.getRow();
    return {
      localLoginEnabled: row.localLoginEnabled,
      oidcEnabled: row.oidcEnabled,
      autoProvision: row.oidcAutoProvision,
      allowedDomains: parseDomainList(row.oidcAllowedDomains),
    };
  }

  async get(): Promise<AuthSettingsDto> {
    const row = await this.settingsService.getRow();
    return {
      localLoginEnabled: row.localLoginEnabled,
      oidcEnabled: row.oidcEnabled,
      tenantId: row.oidcTenantId,
      clientId: row.oidcClientId,
      hasClientSecret: Boolean(row.oidcClientSecretEncrypted),
      autoProvision: row.oidcAutoProvision,
      allowedDomains: parseDomainList(row.oidcAllowedDomains),
      buttonLabel: row.oidcButtonLabel?.trim() || DEFAULT_BUTTON_LABEL,
      redirectUri: `${this.config.publicUrl.replace(/\/+$/, '')}/v1/auth/microsoft/callback`,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** Was die Anmeldeseite ohne Anmeldung wissen muss. */
  async getLoginMethods(): Promise<LoginMethodsDto> {
    const row = await this.settingsService.getRow();
    const microsoft = isOidcComplete(row);
    return {
      // Ohne funktionierendes M365 bleibt die lokale Anmeldung sichtbar, auch
      // wenn sie abgeschaltet wurde – sonst stünde man vor einer leeren Seite.
      local: row.localLoginEnabled || !microsoft,
      microsoft,
      microsoftLabel: row.oidcButtonLabel?.trim() || DEFAULT_BUTTON_LABEL,
    };
  }

  /** Darf sich dieser Benutzer mit Passwort anmelden? */
  async isLocalLoginAllowed(role: 'ADMIN' | 'MEMBER' | 'GUEST'): Promise<boolean> {
    // Gäste haben ohnehin kein Passwort; die Sperre zielt aufs Team.
    if (role === 'GUEST') return true;
    const row = await this.settingsService.getRow();
    if (row.localLoginEnabled) return true;
    // Ist M365 nicht (mehr) vollständig eingerichtet, gilt die Abschaltung
    // nicht – sonst käme niemand mehr herein.
    return !isOidcComplete(row);
  }

  async update(input: UpdateAuthSettingsInput): Promise<AuthSettingsDto> {
    const row = await this.settingsService.getRow();

    // Der entscheidende Schutz: Die lokale Anmeldung darf nur weg, wenn der
    // andere Weg nachweislich vollständig eingerichtet ist.
    const nachher = {
      oidcEnabled: input.oidcEnabled ?? row.oidcEnabled,
      oidcTenantId: input.tenantId === undefined ? row.oidcTenantId : input.tenantId?.trim() || null,
      oidcClientId: input.clientId === undefined ? row.oidcClientId : input.clientId?.trim() || null,
      oidcClientSecretEncrypted:
        input.clientSecret === undefined
          ? row.oidcClientSecretEncrypted
          : input.clientSecret
            ? 'gesetzt'
            : null,
    };
    const localNachher = input.localLoginEnabled ?? row.localLoginEnabled;

    if (!localNachher && !isOidcComplete(nachher)) {
      throw new BadRequestException(
        'Die lokale Anmeldung lässt sich erst abschalten, wenn Microsoft 365 aktiv und vollständig eingerichtet ist – sonst sperrst du dich aus.',
      );
    }

    await this.db
      .update(appSettings)
      .set({
        localLoginEnabled: input.localLoginEnabled,
        oidcEnabled: input.oidcEnabled,
        oidcTenantId: input.tenantId === undefined ? undefined : input.tenantId?.trim() || null,
        oidcClientId: input.clientId === undefined ? undefined : input.clientId?.trim() || null,
        oidcClientSecretEncrypted:
          input.clientSecret === undefined
            ? undefined
            : input.clientSecret
              ? encryptSecret(input.clientSecret, this.config.jwt.secret)
              : null,
        oidcAutoProvision: input.autoProvision,
        oidcAllowedDomains:
          input.allowedDomains === undefined
            ? undefined
            : parseDomainList(input.allowedDomains).join(', ') || null,
        oidcButtonLabel:
          input.buttonLabel === undefined ? undefined : input.buttonLabel?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    this.logger.log(
      `Anmeldeeinstellungen geändert (lokal: ${localNachher ? 'an' : 'aus'}, M365: ${nachher.oidcEnabled ? 'an' : 'aus'}).`,
    );
    return this.get();
  }

  /** `null`, solange Microsoft 365 nicht vollständig eingerichtet ist. */
  async getOidcCredentials(): Promise<OidcCredentials | null> {
    const row = await this.settingsService.getRow();
    if (!isOidcComplete(row)) return null;

    const clientSecret = decryptSecret(row.oidcClientSecretEncrypted, this.config.jwt.secret);
    if (!clientSecret) {
      this.logger.error(
        'Das Client-Secret lässt sich nicht entschlüsseln. Wurde JWT_SECRET geändert? Dann bitte neu eintragen.',
      );
      return null;
    }

    return {
      tenantId: row.oidcTenantId as string,
      clientId: row.oidcClientId as string,
      clientSecret,
    };
  }
}

/** Aktiv **und** alle drei Angaben vorhanden. */
function isOidcComplete(row: {
  oidcEnabled: boolean;
  oidcTenantId: string | null;
  oidcClientId: string | null;
  oidcClientSecretEncrypted: string | null;
}): boolean {
  return Boolean(
    row.oidcEnabled && row.oidcTenantId && row.oidcClientId && row.oidcClientSecretEncrypted,
  );
}
