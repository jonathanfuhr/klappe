/**
 * Rechnerei rund um Entra ID (Microsoft 365), ohne Netzwerk – damit sich
 * Adressen, Aussteller-Prüfung und Anspruchsauswertung ohne echten Tenant
 * prüfen lassen.
 */

/** Adresse des Erkennungsdokuments für einen Tenant. */
export function discoveryUrl(tenantId: string, authority = 'https://login.microsoftonline.com'): string {
  return `${authority.replace(/\/+$/, '')}/${encodeURIComponent(tenantId.trim())}/v2.0/.well-known/openid-configuration`;
}

export interface AuthorizeUrlInput {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** Vorschlag fürs Anmeldefenster, damit der Kunde nicht raten muss. */
  loginHint?: string | null;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_mode', 'query');
  // `openid` allein liefert kein Profil; Name und Adresse kommen aus den
  // beiden anderen und ersparen einen Extra-Aufruf gegen Graph.
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

/**
 * Der Aussteller im Erkennungsdokument enthält bei den Sammel-Tenants
 * `common` und `organizations` den Platzhalter `{tenantid}`. Er wird durch
 * den `tid`-Anspruch des Tokens ersetzt – genau so macht es auch Microsofts
 * eigene Bibliothek.
 */
export function expectedIssuer(discoveryIssuer: string, tokenTenantId: string | null): string {
  if (!discoveryIssuer.includes('{tenantid}')) return discoveryIssuer;
  if (!tokenTenantId) return discoveryIssuer;
  return discoveryIssuer.replace('{tenantid}', tokenTenantId);
}

export interface EntraClaims {
  /** Stabile Kennung des Kontos im Tenant. */
  oid?: string;
  tid?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
  name?: string;
  nonce?: string;
  sub?: string;
}

/**
 * Die Adresse steht je nach Kontotyp in einem anderen Anspruch. Reihenfolge
 * nach Verlässlichkeit: `email` ist gesetzt, wenn das Konto eine Mailadresse
 * hat; `preferred_username` ist bei Arbeitskonten die Anmeldeadresse; `upn`
 * ist der Rückfall für ältere Tenants.
 */
export function emailFromClaims(claims: EntraClaims): string | null {
  for (const candidate of [claims.email, claims.preferred_username, claims.upn]) {
    const value = candidate?.trim().toLowerCase();
    // `preferred_username` darf laut Spezifikation auch etwas ohne @ sein.
    if (value && value.includes('@')) return value;
  }
  return null;
}

export function nameFromClaims(claims: EntraClaims, fallbackEmail: string): string {
  const name = claims.name?.trim();
  if (name) return name;
  // Aus `vorname.nachname@…` wird „Vorname Nachname“.
  const local = fallbackEmail.split('@')[0] ?? fallbackEmail;
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || fallbackEmail
  );
}

/**
 * Prüft die Adresse gegen die erlaubten Domänen. Eine leere Liste heißt:
 * keine Einschränkung – nicht etwa „nichts erlaubt“.
 */
export function domainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return allowedDomains.some((entry) => {
    const allowed = entry.trim().toLowerCase().replace(/^@/, '');
    return allowed.length > 0 && domain === allowed;
  });
}

/** `"thd.de, @beispiel.org"` → `['thd.de', 'beispiel.org']` */
export function parseDomainList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter((entry) => entry.length > 0);
}
