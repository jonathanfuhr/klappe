/**
 * App-only-Zugriffstoken für den SMTP-Versand über Microsoft 365, per
 * Client-Credentials-Fluss gegen Entra ID (RFC 6749 §4.4).
 *
 * Nötig, weil SMTP AUTH mit Benutzername und Kennwort an erzwungener
 * Mehrfaktor-Anmeldung scheitert – auch ein App-Kennwort hilft dabei nicht
 * zuverlässig (siehe `settings/smtp-presets.ts`). Die Berechtigung
 * `SMTP.SendAsApp` (eine Exchange-Online-, keine Microsoft-Graph-Berechtigung)
 * wird per RBAC für Anwendungen in Exchange Online PowerShell vergeben
 * (`New-ServicePrincipal`, `New-ManagementScope`,
 * `New-ManagementRoleAssignment`) und dabei auf das sendende Postfach
 * eingeschränkt – siehe README für die genauen Schritte. Ohne diese
 * Einschränkung dürfte die App tenant-weit als jedes Postfach senden.
 *
 * Anders als beim Anmelde-Fluss (`auth/microsoft/microsoft.service.ts`) gibt
 * es hier keinen Benutzer und kein Redirect – nur die drei Werte aus der
 * App-Registrierung.
 */
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/configuration';
import { ms365TokenUrl } from './ms365-oauth';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const HTTP_TIMEOUT_MS = 10_000;
/** Anwendungsberechtigung fürs Senden per SMTP – siehe Klassenkommentar. */
const SCOPE = 'https://outlook.office365.com/.default';
/** Ein Token, das gleich abläuft, ist beim Verbindungsaufbau schon nutzlos. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

@Injectable()
export class Ms365OauthService {
  private readonly logger = new Logger(Ms365OauthService.name);
  private cache: { key: string; accessToken: string; expiresAt: number } | null = null;

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async getAccessToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
    const url = ms365TokenUrl(tenantId, this.config.oidc.authority);
    const key = `${url}:${clientId}`;
    if (this.cache && this.cache.key === key && this.cache.expiresAt > Date.now()) {
      return this.cache.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPE,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as TokenResponse | null;

    if (!response.ok || !payload?.access_token) {
      // Die Beschreibung von Microsoft nennt meist genau den Fehler in der
      // App-Registrierung (fehlende Zustimmung, abgelaufenes Secret, falscher
      // Tenant).
      const detail = payload?.error_description ?? payload?.error ?? `HTTP ${response.status}`;
      this.logger.warn(`Zugriffstoken für den Mailversand nicht erhalten: ${detail}`);
      this.cache = null;
      throw new ServiceUnavailableException(`Entra ID hat das Zugriffstoken abgelehnt: ${detail}`);
    }

    this.cache = {
      key,
      accessToken: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 - EXPIRY_SAFETY_MARGIN_MS,
    };
    return this.cache.accessToken;
  }
}
