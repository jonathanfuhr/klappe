import type { Locale, SmtpProviderPresetDto } from '@klappe/shared';
import { DEFAULT_LOCALE } from '@klappe/shared';

/**
 * Vorbelegungen für die SMTP-Felder.
 *
 * Bewusst *nur* Host, Port und TLS – kein Anbieter bekommt eine eigene
 * Integration. Dadurch lässt sich der Dienst wechseln, ohne dass am Code
 * etwas passiert, und exotische Anbieter gehen über „Eigener Server“.
 *
 * Name und Hinweis stehen je Sprache (Phase 26), wie bei den Mail-Vorlagen.
 * Sie hier zu führen statt im Wörterbuch der Oberfläche hat einen Grund: Wer
 * einen Anbieter ergänzt, soll eine Datei anfassen müssen und nicht drei –
 * und Hinweis und Hostname gehören ohnehin zusammen.
 *
 * Die meisten Namen sind Eigennamen und stehen deshalb zweimal gleich da.
 * Das ist Absicht: Eine Ausnahmeregel „diese zwei Felder sind übersetzbar,
 * die anderen sieben nicht“ wäre für den nächsten Eintrag eine Stolperstelle.
 */
interface PresetTexte {
  name: string;
  hint: string;
}

interface SmtpPreset {
  id: string;
  host: string;
  port: number;
  secure: boolean;
  texte: Record<Locale, PresetTexte>;
}

const PRESETS: SmtpPreset[] = [
  {
    id: 'brevo',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Brevo',
        hint: 'Benutzername ist die Brevo-Login-Adresse, Passwort der SMTP-Schlüssel.',
      },
      en: {
        name: 'Brevo',
        hint: 'The user name is the Brevo login address, the password is the SMTP key.',
      },
    },
  },
  {
    id: 'mailgun',
    host: 'smtp.eu.mailgun.org',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Mailgun',
        hint: 'Für Konten außerhalb der EU smtp.mailgun.org eintragen.',
      },
      en: {
        name: 'Mailgun',
        hint: 'For accounts outside the EU, enter smtp.mailgun.org instead.',
      },
    },
  },
  {
    id: 'postmark',
    host: 'smtp.postmarkapp.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Postmark',
        hint: 'Benutzername und Passwort sind beide das Server-API-Token.',
      },
      en: {
        name: 'Postmark',
        hint: 'User name and password are both the server API token.',
      },
    },
  },
  {
    id: 'ses',
    host: 'email-smtp.eu-central-1.amazonaws.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Amazon SES',
        hint: 'Region im Hostnamen anpassen; Zugangsdaten sind eigene SMTP-Credentials.',
      },
      en: {
        name: 'Amazon SES',
        hint: 'Adjust the region in the host name; the credentials are dedicated SMTP credentials.',
      },
    },
  },
  {
    id: 'microsoft365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Microsoft 365',
        hint:
          'Das Postfach braucht SMTP AUTH. Erzwingt der Tenant Mehrfaktor-Anmeldung, lehnt ' +
          'der Server ein Kennwort ab – dann unten die Authentifizierung auf OAuth2 umstellen.',
      },
      en: {
        name: 'Microsoft 365',
        hint:
          'The mailbox needs SMTP AUTH. If the tenant enforces multi-factor sign-in, the ' +
          'server rejects a password – then switch authentication to OAuth2 below.',
      },
    },
  },
  // Die drei folgenden sind gewöhnliche Postfächer, keine Versanddienste. Alle
  // drei verlangen ein eigens erzeugtes Kennwort – das normale Anmeldekennwort
  // wird abgewiesen, sobald Zwei-Faktor an ist. Genau daran scheitert die
  // Einrichtung sonst, deshalb steht der Weg dorthin im Hinweis.
  {
    id: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Google / Gmail',
        hint:
          'Zwei-Faktor muss an sein, dann unter myaccount.google.com/apppasswords ein ' +
          'App-Passwort erzeugen. Benutzername ist die volle Adresse, Passwort das ' +
          '16-stellige App-Passwort (ohne Leerzeichen).',
      },
      en: {
        name: 'Google / Gmail',
        hint:
          'Two-factor has to be on, then create an app password at ' +
          'myaccount.google.com/apppasswords. The user name is the full address, the ' +
          'password is the 16-character app password (without spaces).',
      },
    },
  },
  {
    id: 'outlook',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Outlook.com (privat)',
        hint:
          'Nicht für Microsoft 365 aus dem Geschäftskonto – dafür den Eintrag darüber ' +
          'nehmen. App-Passwort unter account.microsoft.com → Sicherheit → Erweiterte ' +
          'Sicherheitsoptionen.',
      },
      en: {
        name: 'Outlook.com (personal)',
        hint:
          'Not for Microsoft 365 from a work account – use the entry above for that. App ' +
          'password under account.microsoft.com → Security → Advanced security options.',
      },
    },
  },
  {
    id: 'icloud',
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'iCloud Mail',
        hint:
          'Braucht zwingend ein app-spezifisches Passwort: account.apple.com → Anmelden ' +
          'und Sicherheit → App-spezifische Passwörter. Als Absender geht nur eine ' +
          'Adresse, die dem Konto gehört (auch eine eigene Domain, wenn sie dort ' +
          'eingerichtet ist).',
      },
      en: {
        name: 'iCloud Mail',
        hint:
          'Requires an app-specific password: account.apple.com → Sign-In and Security → ' +
          'App-Specific Passwords. Only an address that belongs to the account works as ' +
          'the sender (including your own domain, if it is set up there).',
      },
    },
  },
  {
    id: 'custom',
    host: '',
    port: 587,
    secure: false,
    texte: {
      de: {
        name: 'Eigener Server',
        hint: 'Port 465 bedeutet implizites TLS, Port 587 STARTTLS.',
      },
      en: {
        name: 'Own server',
        hint: 'Port 465 means implicit TLS, port 587 means STARTTLS.',
      },
    },
  },
];

function ausgeben(preset: SmtpPreset, locale: Locale): SmtpProviderPresetDto {
  const { texte, ...verbindung } = preset;
  return { ...verbindung, ...(texte[locale] ?? texte[DEFAULT_LOCALE]) };
}

/** Die Vorbelegungen in der Sprache des Anfragenden. */
export function smtpPresets(locale: Locale): SmtpProviderPresetDto[] {
  return PRESETS.map((preset) => ausgeben(preset, locale));
}
