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
  // Die drei folgenden sind gewöhnliche Postfächer, keine Versanddienste. Alle
  // drei verlangen ein eigens erzeugtes Kennwort – das normale Anmeldekennwort
  // wird abgewiesen, sobald Zwei-Faktor an ist. Genau daran scheitert die
  // Einrichtung sonst, deshalb steht der Weg dorthin im Hinweis.
  {
    id: 'gmail',
    name: 'Google / Gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    hint:
      'Zwei-Faktor muss an sein, dann unter myaccount.google.com/apppasswords ein ' +
      'App-Passwort erzeugen. Benutzername ist die volle Adresse, Passwort das ' +
      '16-stellige App-Passwort (ohne Leerzeichen).',
  },
  {
    id: 'outlook',
    name: 'Outlook.com (privat)',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    hint:
      'Nicht für Microsoft 365 aus dem Geschäftskonto – dafür den Eintrag darüber ' +
      'nehmen. App-Passwort unter account.microsoft.com → Sicherheit → Erweiterte ' +
      'Sicherheitsoptionen.',
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    hint:
      'Braucht zwingend ein app-spezifisches Passwort: account.apple.com → Anmelden ' +
      'und Sicherheit → App-spezifische Passwörter. Als Absender geht nur eine ' +
      'Adresse, die dem Konto gehört (auch eine eigene Domain, wenn sie dort ' +
      'eingerichtet ist).',
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
