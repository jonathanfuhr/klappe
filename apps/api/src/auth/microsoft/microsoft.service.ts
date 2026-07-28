/**
 * Anmeldung über Microsoft 365 (Entra ID), Phase 11.
 *
 * Umgesetzt ist der Authorization-Code-Fluss mit PKCE. Der Code wird auf dem
 * Server gegen ein ID-Token getauscht; dessen Signatur wird gegen die
 * öffentlichen Schlüssel des Tenants geprüft, obwohl das Token aus einer
 * direkten TLS-Verbindung stammt. Der Aufwand ist gering, und bei einem
 * Anmeldeweg will man sich nicht auf „kommt schon vom Richtigen" verlassen.
 *
 * Was hier bewusst *nicht* passiert: Es wird kein Zugriffstoken für Graph
 * angefordert. Klappe braucht nur Name und Adresse, und die stehen im
 * ID-Token.
 */
import { createPublicKey } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../../common/normalize';
import { AppConfig, CONFIG } from '../../config/configuration';
import { DB, type Database } from '../../db/db.module';
import { type UserRow, users } from '../../db/schema';
import { AuthSettingsService, type OidcCredentials } from '../../settings/auth-settings.service';
import {
  type EntraClaims,
  buildAuthorizeUrl,
  discoveryUrl,
  domainAllowed,
  emailFromClaims,
  expectedIssuer,
  nameFromClaims,
} from './entra';
import { createPkcePair, createRandomToken } from './pkce';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n?: string;
  e?: string;
  use?: string;
}

/** Inhalt des kurzlebigen Kekses zwischen Start und Rückkehr. */
interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
  redirect: string;
}

/** So lange darf der Anmeldevorgang dauern, bevor er neu begonnen werden muss. */
const FLOW_TTL_SECONDS = 10 * 60;
/** Erkennungsdokument und Schlüssel ändern sich selten. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const JWKS_TTL_MS = 60 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;

export const MICROSOFT_FLOW_COOKIE = 'klappe_m365_flow';

@Injectable()
export class MicrosoftAuthService {
  private readonly logger = new Logger(MicrosoftAuthService.name);
  private discoveryCache: { key: string; at: number; value: Discovery } | null = null;
  private jwksCache: { uri: string; at: number; keys: Jwk[] } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly authSettings: AuthSettingsService,
    private readonly jwtService: JwtService,
  ) {}

  /** Adresse, die in der App-Registrierung als Redirect-URI stehen muss. */
  redirectUri(): string {
    return `${this.config.publicUrl.replace(/\/+$/, '')}/v1/auth/microsoft/callback`;
  }

  /**
   * Beginn des Anmeldevorgangs: Zufallswerte erzeugen, in einem signierten
   * Keks ablegen und zu Microsoft schicken.
   *
   * Der Zustand liegt bewusst im Keks und nicht in der Datenbank – so
   * überlebt ein angefangener Anmeldevorgang keinen Neustart, was hier genau
   * richtig ist, und es bleibt nichts liegen, das aufgeräumt werden müsste.
   */
  async begin(input: { redirect?: string; loginHint?: string }): Promise<{
    url: string;
    cookie: string;
  }> {
    const credentials = await this.requireCredentials();
    const discovery = await this.getDiscovery(credentials);

    const { verifier, challenge } = createPkcePair();
    const flow: FlowState = {
      state: createRandomToken(),
      nonce: createRandomToken(),
      verifier,
      // Nur Pfade innerhalb der eigenen App – sonst wäre das eine offene
      // Weiterleitung, über die sich Kunden auf fremde Seiten schicken ließen.
      redirect: safeRedirect(input.redirect),
    };

    const cookie = await this.jwtService.signAsync(flow, {
      secret: this.config.jwt.secret,
      expiresIn: FLOW_TTL_SECONDS,
    });

    return {
      url: buildAuthorizeUrl({
        authorizationEndpoint: discovery.authorization_endpoint,
        clientId: credentials.clientId,
        redirectUri: this.redirectUri(),
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge: challenge,
        loginHint: input.loginHint ?? null,
      }),
      cookie,
    };
  }

  /**
   * Rückkehr von Microsoft: Zustand prüfen, Code eintauschen, ID-Token
   * prüfen, Konto zuordnen.
   */
  async complete(input: {
    code: string;
    state: string;
    cookie: string | undefined;
  }): Promise<{ user: UserRow; redirect: string }> {
    if (!input.cookie) {
      throw new BadRequestException(
        'Der Anmeldevorgang ist abgelaufen oder wurde in einem anderen Browser begonnen. Bitte noch einmal anfangen.',
      );
    }

    let flow: FlowState;
    try {
      flow = await this.jwtService.verifyAsync<FlowState>(input.cookie, {
        secret: this.config.jwt.secret,
      });
    } catch {
      throw new BadRequestException('Der Anmeldevorgang ist abgelaufen. Bitte noch einmal anfangen.');
    }

    // Ohne diesen Abgleich könnte jemand eine fremde Antwort unterschieben.
    if (!input.state || input.state !== flow.state) {
      throw new BadRequestException('Die Antwort von Microsoft passt nicht zum Anmeldevorgang.');
    }

    const credentials = await this.requireCredentials();
    const discovery = await this.getDiscovery(credentials);
    const idToken = await this.exchangeCode(discovery, credentials, input.code, flow.verifier);
    const claims = await this.verifyIdToken(idToken, discovery, credentials, flow.nonce);

    const user = await this.resolveUser(claims);
    return { user, redirect: flow.redirect };
  }

  // ---------- Einzelschritte ----------

  private async requireCredentials(): Promise<OidcCredentials> {
    const credentials = await this.authSettings.getOidcCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'Die Anmeldung über Microsoft 365 ist nicht eingerichtet.',
      );
    }
    return credentials;
  }

  private async getDiscovery(credentials: OidcCredentials): Promise<Discovery> {
    const url = discoveryUrl(credentials.tenantId, this.config.oidc.authority);
    if (this.discoveryCache && this.discoveryCache.key === url) {
      if (Date.now() - this.discoveryCache.at < DISCOVERY_TTL_MS) return this.discoveryCache.value;
    }

    const value = await fetchJson<Discovery>(url);
    if (!value.token_endpoint || !value.authorization_endpoint || !value.jwks_uri) {
      throw new ServiceUnavailableException(
        `Das Erkennungsdokument des Tenants ist unvollständig (${url}).`,
      );
    }

    this.discoveryCache = { key: url, at: Date.now(), value };
    return value;
  }

  /** Code gegen ID-Token tauschen. Läuft serverseitig, mit Secret und Verifier. */
  private async exchangeCode(
    discovery: Discovery,
    credentials: OidcCredentials,
    code: string,
    verifier: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
      code_verifier: verifier,
      scope: 'openid profile email',
    });

    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    const payload = (await response.json().catch(() => null)) as
      | { id_token?: string; error?: string; error_description?: string }
      | null;

    if (!response.ok || !payload?.id_token) {
      // Die Beschreibung von Microsoft nennt meist genau den Fehler in der
      // App-Registrierung (falsche Redirect-URI, abgelaufenes Secret).
      const detail = payload?.error_description ?? payload?.error ?? `HTTP ${response.status}`;
      this.logger.warn(`Token-Tausch fehlgeschlagen: ${detail}`);
      throw new UnauthorizedException(`Microsoft hat die Anmeldung abgelehnt: ${detail}`);
    }

    return payload.id_token;
  }

  /**
   * Prüft Signatur, Aussteller, Zielgruppe, Laufzeit und `nonce`.
   *
   * Der `nonce`-Abgleich ist der Schutz gegen ein wiedereingespieltes Token:
   * Nur wer den Anmeldevorgang in diesem Browser begonnen hat, kennt ihn.
   */
  private async verifyIdToken(
    idToken: string,
    discovery: Discovery,
    credentials: OidcCredentials,
    nonce: string,
  ): Promise<EntraClaims> {
    const header = decodeSegment<{ kid?: string; alg?: string }>(idToken, 0);
    const unverified = decodeSegment<EntraClaims>(idToken, 1);
    if (!header?.kid) throw new UnauthorizedException('Das Token von Microsoft hat keinen Schlüsselhinweis.');

    const pem = await this.publicKeyPem(discovery.jwks_uri, header.kid);

    let claims: EntraClaims;
    try {
      claims = await this.jwtService.verifyAsync<EntraClaims>(idToken, {
        publicKey: pem,
        algorithms: ['RS256'],
        audience: credentials.clientId,
        issuer: expectedIssuer(discovery.issuer, unverified?.tid ?? null),
        clockTolerance: 60,
      });
    } catch (error) {
      this.logger.warn(`ID-Token nicht gültig: ${String(error)}`);
      throw new UnauthorizedException('Das Token von Microsoft ist nicht gültig.');
    }

    if (claims.nonce !== nonce) {
      throw new UnauthorizedException('Das Token gehört nicht zu diesem Anmeldevorgang.');
    }

    return claims;
  }

  /** Öffentlicher Schlüssel des Tenants zum `kid` des Tokens, als PEM. */
  private async publicKeyPem(jwksUri: string, kid: string): Promise<string> {
    let keys = await this.getJwks(jwksUri);
    let jwk = keys.find((key) => key.kid === kid);

    // Microsoft tauscht Schlüssel regelmäßig. Ist der gesuchte nicht dabei,
    // wird einmal frisch geladen, bevor aufgegeben wird.
    if (!jwk) {
      this.jwksCache = null;
      keys = await this.getJwks(jwksUri);
      jwk = keys.find((key) => key.kid === kid);
    }
    if (!jwk) throw new UnauthorizedException('Der Signaturschlüssel des Tokens ist unbekannt.');

    try {
      return createPublicKey({ key: jwk as never, format: 'jwk' })
        .export({ type: 'spki', format: 'pem' })
        .toString();
    } catch (error) {
      throw new UnauthorizedException(`Der Signaturschlüssel ist unbrauchbar: ${String(error)}`);
    }
  }

  private async getJwks(uri: string): Promise<Jwk[]> {
    if (this.jwksCache && this.jwksCache.uri === uri && Date.now() - this.jwksCache.at < JWKS_TTL_MS) {
      return this.jwksCache.keys;
    }
    const document = await fetchJson<{ keys: Jwk[] }>(uri);
    const keys = document.keys ?? [];
    this.jwksCache = { uri, at: Date.now(), keys };
    return keys;
  }

  /**
   * Konto zur Adresse aus dem Token finden – oder anlegen, wenn das
   * ausdrücklich erlaubt ist.
   *
   * Ohne diese Einstellung kommt nur herein, wer schon ein Team-Konto hat.
   * Das ist die sichere Voreinstellung: Sonst könnte in einem großen Tenant
   * jeder Mitarbeiter sämtliche Projekte sehen.
   */
  private async resolveUser(claims: EntraClaims): Promise<UserRow> {
    const email = emailFromClaims(claims);
    if (!email) {
      throw new UnauthorizedException(
        'Microsoft hat keine E-Mail-Adresse mitgeschickt. Bitte im Konto eine hinterlegen.',
      );
    }

    const settings = await this.authSettings.getRaw();
    const normalized = normalizeEmail(email);

    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);

    if (existing) {
      if (!existing.isActive) throw new ForbiddenException('Dieses Konto ist gesperrt.');
      if (existing.role === 'GUEST') {
        throw new ForbiddenException(
          'Diese Adresse gehört zu einem Gastzugang. Bitte den Freigabe-Link benutzen.',
        );
      }

      const [updated] = await this.db
        .update(users)
        .set({
          name: nameFromClaims(claims, normalized),
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();

      this.logger.log(`Anmeldung über Microsoft 365: ${updated.email}`);
      return updated;
    }

    if (!settings.autoProvision) {
      throw new ForbiddenException(
        `Für ${normalized} gibt es hier kein Konto. Ein Administrator muss es zuerst anlegen.`,
      );
    }
    if (!domainAllowed(normalized, settings.allowedDomains)) {
      throw new ForbiddenException(
        `Adressen der Domäne ${normalized.split('@')[1] ?? '?'} sind hier nicht zugelassen.`,
      );
    }

    const [created] = await this.db
      .insert(users)
      .values({
        email: normalized,
        name: nameFromClaims(claims, normalized),
        role: 'MEMBER',
        // Kein Passwort: Dieses Konto meldet sich ausschließlich über M365 an.
        passwordHash: null,
        lastLoginAt: new Date(),
      })
      .returning();

    this.logger.log(`Neues Team-Konto über Microsoft 365 angelegt: ${created.email}`);
    return created;
  }
}

/** Nur eigene Pfade – eine offene Weiterleitung wäre eine Phishing-Rampe. */
function safeRedirect(value: string | undefined): string {
  if (!value) return '/projekte';
  if (!value.startsWith('/') || value.startsWith('//')) return '/projekte';
  return value;
}

function decodeSegment<T>(token: string, index: number): T | null {
  try {
    const segment = token.split('.')[index];
    if (!segment) return null;
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!response.ok) {
    throw new ServiceUnavailableException(`${url} antwortete mit HTTP ${response.status}.`);
  }
  return (await response.json()) as T;
}
