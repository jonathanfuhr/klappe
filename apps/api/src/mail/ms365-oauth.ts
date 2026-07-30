/**
 * Rechnerei rund um den Client-Credentials-Fluss gegen Entra ID, ohne
 * Netzwerk – siehe `auth/microsoft/entra.ts` für dasselbe Muster beim
 * Anmelde-Fluss.
 */

/** Adresse des Token-Endpunkts für den Client-Credentials-Fluss (RFC 6749 §4.4). */
export function ms365TokenUrl(tenantId: string, authority = 'https://login.microsoftonline.com'): string {
  return `${authority.replace(/\/+$/, '')}/${encodeURIComponent(tenantId.trim())}/oauth2/v2.0/token`;
}
