import type { SmtpProviderPresetDto } from '@klappe/shared';

/**
 * Vorbelegungen für die SMTP-Felder.
 *
 * Bewusst *nur* Host, Port und TLS – kein Anbieter bekommt eine eigene
 * Integration. Dadurch lässt sich der Dienst wechseln, ohne dass am Code
 * etwas passiert, und exotische Anbieter gehen über „Eigener Server“.
 */
export const SMTP_PRESETS: SmtpProviderPresetDto[] = [
  {
    id: 'brevo',
    name: 'Brevo',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    hint: 'Benutzername ist die Brevo-Login-Adresse, Passwort der SMTP-Schlüssel.',
  },
  {
    id: 'mailgun',
    name: 'Mailgun',
    host: 'smtp.eu.mailgun.org',
    port: 587,
    secure: false,
    hint: 'Für Konten außerhalb der EU smtp.mailgun.org eintragen.',
  },
  {
    id: 'postmark',
    name: 'Postmark',
    host: 'smtp.postmarkapp.com',
    port: 587,
    secure: false,
    hint: 'Benutzername und Passwort sind beide das Server-API-Token.',
  },
  {
    id: 'ses',
    name: 'Amazon SES',
    host: 'email-smtp.eu-central-1.amazonaws.com',
    port: 587,
    secure: false,
    hint: 'Region im Hostnamen anpassen; Zugangsdaten sind eigene SMTP-Credentials.',
  },
  {
    id: 'microsoft365',
    name: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    hint: 'Das Postfach braucht SMTP AUTH; mit MFA ist ein App-Kennwort nötig.',
  },
  {
    id: 'custom',
    name: 'Eigener Server',
    host: '',
    port: 587,
    secure: false,
    hint: 'Port 465 bedeutet implizites TLS, Port 587 STARTTLS.',
  },
];

export function findPreset(id: string | null | undefined): SmtpProviderPresetDto | null {
  if (!id) return null;
  return SMTP_PRESETS.find((preset) => preset.id === id) ?? null;
}
