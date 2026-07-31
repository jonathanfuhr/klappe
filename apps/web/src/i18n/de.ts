import type { Dictionary } from '@klappe/shared';

/**
 * Deutsches Wörterbuch der Oberfläche (Phase 26) – die **Quellsprache**.
 *
 * Hier steht der Text, so wie er gemeint ist; alle anderen Sprachen werden
 * dagegen typgeprüft (siehe `en.ts`). Ein Eintrag mit `one`/`other` wird über
 * `t(key, { count })` gezogen und wählt Einzahl oder Mehrzahl.
 *
 * Die Schlüssel sind nach Bereichen benannt (`shell.`, `login.`, …). Was an
 * mehreren Stellen gleich heißt – Speichern, Abbrechen, Löschen –, steht unter
 * `common.` und wird nicht doppelt gepflegt.
 */
export const de = {
  // ---------- Wiederkehrendes ----------
  'common.save': 'Speichern',
  'common.saving': 'Wird gespeichert …',
  'common.saved': 'Gespeichert.',
  'common.cancel': 'Abbrechen',
  'common.close': 'Schließen',
  'common.delete': 'Löschen',
  'common.deleteFinally': 'Endgültig löschen',
  'common.rename': 'Umbenennen',
  'common.edit': 'Bearbeiten',
  'common.create': 'Anlegen',
  'common.remove': 'Entfernen',
  'common.copy': 'Kopieren',
  'common.copied': 'Kopiert',
  'common.loading': 'Wird geladen …',
  'common.actions': 'Aktionen',
  'common.search': 'Suchen',
  'common.searchPlaceholder': 'Suchen …',
  'common.optional': 'optional',
  'common.name': 'Name',
  'common.email': 'E-Mail-Adresse',
  'common.password': 'Passwort',
  'common.loadFailed': 'Laden fehlgeschlagen.',
  'common.saveFailed': 'Speichern fehlgeschlagen.',
  'common.deleteFailed': 'Löschen fehlgeschlagen.',
  'common.changeFailed': 'Ändern fehlgeschlagen.',
  'common.createFailed': 'Anlegen fehlgeschlagen.',
  'common.uploadFailed': 'Hochladen fehlgeschlagen.',
  'common.removeFailed': 'Entfernen fehlgeschlagen.',

  // ---------- Kopfzeile und Benutzer-Menü ----------
  'shell.projects': 'Projekte',
  'shell.userMenu': 'Benutzermenü',
  'shell.profile': 'Profil und Sicherheit',
  'shell.manual': 'Handbuch',
  'shell.about': 'Über diese Software',
  'shell.settings': 'Einstellungen',
  'shell.logout': 'Abmelden',
  'shell.guestBadge': 'Gast',

  // ---------- Anmeldung ----------
  'login.tagline': 'Review und Freigabe für Videoproduktionen',
  'login.or': 'oder',
  'login.submit': 'Anmelden',
  'login.submitting': 'Wird angemeldet …',
  'login.failed': 'Anmeldung fehlgeschlagen.',
  'login.cookieRejected':
    'Passwort richtig, aber der Browser hat das Sitzungs-Cookie verworfen. Das passiert, wenn SESSION_COOKIE_SECURE=1 gesetzt ist, die Seite aber über http:// statt https:// aufgerufen wird.',
  'login.microsoftOnly':
    'Für Team-Konten ist in diesem Workspace nur die Anmeldung über Microsoft 365 vorgesehen.',
  'login.guestAccess': 'Gastzugang',
  'login.guestHint':
    'Für Kunden, die schon eine Freigabe haben – ohne Passwort, mit einem Code per Mail.',

  // ---------- Werkzeugleisten ----------
  'toolbar.filter': 'Filter',
  'toolbar.filterWithCount': 'Filter ({count} gesetzt)',
  'toolbar.filterNone': 'Keine Filter vorhanden.',
  'toolbar.filterNoValues': 'Keine Werte vorhanden.',
  'toolbar.filterReset': 'Filter zurücksetzen',
  'toolbar.sort': 'Sortierung',
  'toolbar.sortCurrent': 'Sortierung: {name}',
  'toolbar.sortByGrouping': 'Solange gruppiert wird, gibt die Gruppierung die Reihenfolge vor.',
  'toolbar.sortUnknown': 'unbekannt',
  'toolbar.group': 'Gruppierung',
  'toolbar.groupCurrent': 'Gruppierung: {name}',
  'toolbar.groupNone': 'Gruppierung: keine',
  'toolbar.closeMenu': 'Menü schließen',

  // ---------- Projektliste ----------
  'projects.title': 'Projekte',
  'projects.countInFilter': { one: '{count} Projekt im Filter', other: '{count} Projekte im Filter' },
  'projects.countInWorkspace': {
    one: '{count} Projekt im Workspace',
    other: '{count} Projekte im Workspace',
  },
  'projects.new': 'Neues Projekt',
  'projects.searchPlaceholder': 'Projekt, Kunde oder Feld …',
  'projects.allTags': 'alle Schlagworte',
  'projects.sortUpdated': 'Zuletzt bearbeitet',
  'projects.sortCreated': 'Zuletzt angelegt',
  'projects.sortName': 'Name',
  'projects.sortCustomer': 'Kunde',
  'projects.groupNone': 'Nicht gruppieren',
  'projects.groupByCustomer': 'Nach Kunde',
  'projects.groupByField': 'Nach {name}',
  'projects.customer': 'Kunde',
  'projects.withoutValue': 'Ohne {name}',
  'projects.emptyFiltered': 'Kein Projekt passt zu diesem Filter.',
  'projects.emptyNone': 'Noch keine Projekte. Leg das erste an, um Videos hochzuladen.',
  'projects.emptySearch': 'Kein Projekt passt zur Suche.',
  'projects.archived': 'archiviert',
  'projects.videoCount': { one: '{count} Video', other: '{count} Videos' },
  'projects.changedAt': 'Geändert {when}',
  'projects.tileActions': 'Aktionen für {name}',
  'projects.customerActions': 'Aktionen für Kunde {name}',
  'projects.renameEllipsis': 'Umbenennen …',
  'projects.deleteEllipsis': 'Löschen …',
  'projects.renameCustomerEllipsis': 'Kunde umbenennen …',
  'projects.createCustomerLabel': 'Kunde (optional)',
  'projects.createCustomerHint':
    'Steht im Download-Dateinamen und hilft beim Zuordnen hochgeladener Dateien.',
  'projects.createDescriptionLabel': 'Beschreibung (optional)',
  'projects.renameCustomerTitle': 'Kunde „{name}“',
  'projects.renameCustomerNewName': 'Neuer Name',
  'projects.renameCustomerHint': {
    one: 'Wirkt auf {count} Projekt – auch in den Download-Dateinamen künftiger Fassungen.',
    other: 'Wirkt auf {count} Projekte – auch in den Download-Dateinamen künftiger Fassungen.',
  },
  'projects.removeCustomerEntry': 'Kundeneintrag entfernen',
  'tags.label': 'Schlagworte',

  // ---------- Sprachwahl ----------
  'locale.label': 'Sprache',
  'locale.followWorkspace': 'Wie im Workspace ({name})',
  'locale.ownHint':
    'Gilt für die Oberfläche, für Fehlermeldungen und für die E-Mails, die du von Klappe bekommst.',
  'locale.workspaceLabel': 'Sprache des Workspace',
  'locale.workspaceHint':
    'Gilt für die Anmeldeseite, den Gastzugang und für alle, die unter „Profil und Sicherheit" nichts eigenes gewählt haben – auch für deren E-Mails.',
} satisfies Dictionary;

/** Alle bekannten Schlüssel – die anderen Sprachen müssen genau diese tragen. */
export type MessageKey = keyof typeof de;
