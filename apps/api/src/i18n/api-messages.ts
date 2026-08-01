/**
 * Die Meldungen der API auf Englisch (Phase 26).
 *
 * **Der deutsche Satz ist der Schlüssel.** Die 229 Stellen, an denen die API
 * eine Ausnahme wirft, bleiben unangetastet: Sie werfen weiter ihren deutschen
 * Satz, und der Fehlerfilter tauscht ihn erst beim Hinausgehen gegen die
 * Übersetzung – wenn der Empfänger Englisch eingestellt hat und der Satz hier
 * steht. Fehlt er, geht Deutsch hinaus. Das ist dasselbe Verfahren wie bei
 * gettext, und es hat denselben Vorteil: Am Wurfort steht ein lesbarer Satz
 * und kein Schlüssel, den man nachschlagen muss.
 *
 * Zwei Tabellen, weil es zwei Arten von Meldungen gibt:
 *
 * - `EXAKT` für Sätze ohne Einsetzung – ein Nachschlagen, fertig.
 * - `MUSTER` für Sätze mit eingesetzten Werten. Dort steht `{}` für jede
 *   Einsetzung; die Werte werden aus dem deutschen Satz herausgelesen und in
 *   den englischen in derselben Reihenfolge wieder eingesetzt.
 *
 * Wer eine Meldung ändert, muss den Eintrag hier mitziehen – sonst bleibt sie
 * auf Deutsch stehen. `api-messages.test.ts` prüft, dass jedes Muster genau
 * eine Einsetzung je `{}` hat und dass beide Seiten gleich viele tragen.
 */

/** Sätze ohne eingesetzte Werte. */
export const EXAKT: Record<string, string> = {
  'Antwort und Kommentar gehören zu verschiedenen Versionen.':
    'Reply and comment belong to different versions.',
  'Benutzer nicht gefunden.': 'User not found.',
  'Bitte eine Bezeichnung angeben.': 'Please enter a name.',
  'Bitte zuerst Host, Port und Absenderadresse speichern und den Versand aktivieren.':
    'Please save host, port and sender address first and switch delivery on.',
  'Content-Type fehlt.': 'Content-Type is missing.',
  'Dafür fehlen die Rechte.': 'You do not have the rights for that.',
  'Dafür fehlen in diesem Projekt die Rechte.':
    'You do not have the rights for that in this project.',
  'Das Format braucht einen Namen.': 'The format needs a name.',
  'Das Format wurde geändert – die Fassung wird neu erzeugt.':
    'The format has changed – the version is being regenerated.',
  'Das Original ist noch nicht vollständig hochgeladen.':
    'The original has not been fully uploaded yet.',
  'Das Passwort muss Groß- und Kleinbuchstaben enthalten.':
    'The password must contain upper and lower case letters.',
  'Das Passwort muss mindestens ein Sonderzeichen enthalten.':
    'The password must contain at least one special character.',
  'Das Passwort muss mindestens eine Ziffer enthalten.':
    'The password must contain at least one digit.',
  'Das Passwort muss mindestens einen Buchstaben enthalten.':
    'The password must contain at least one letter.',
  'Das Token gehört nicht zu diesem Anmeldevorgang.':
    'The token does not belong to this sign-in attempt.',
  'Das Token von Microsoft hat keinen Schlüsselhinweis.':
    'The token from Microsoft carries no key hint.',
  'Das Token von Microsoft ist nicht gültig.': 'The token from Microsoft is not valid.',
  'Das aktuelle Passwort ist falsch.': 'The current password is wrong.',
  'Das ist kein Name einer Sicherung.': 'That is not the name of a backup.',
  'Datei nicht gefunden.': 'File not found.',
  'Dein Zugriff auf diese Freigabe wurde zurückgezogen. Bitte frage nach einem neuen Link.':
    'Your access to this share has been withdrawn. Please ask for a new link.',
  'Der API-Token gilt nicht (mehr).': 'The API token is no longer valid.',
  'Der Anmeldevorgang ist abgelaufen oder wurde in einem anderen Browser begonnen. Bitte noch einmal anfangen.':
    'The sign-in attempt has expired or was started in another browser. Please start again.',
  'Der Anmeldevorgang ist abgelaufen. Bitte noch einmal anfangen.':
    'The sign-in attempt has expired. Please start again.',
  'Der Chunk ist größer als der verbleibende Rest.':
    'The chunk is larger than what is left to upload.',
  'Der Code besteht aus sechs Ziffern.': 'The code consists of six digits.',
  'Der Code ist abgelaufen. Bitte einen neuen anfordern.':
    'The code has expired. Please request a new one.',
  'Der Code stimmt nicht.': 'The code is not correct.',
  'Der Dateiname fehlt.': 'The filename is missing.',
  'Der Kommentar, auf den geantwortet wird, existiert nicht.':
    'The comment being replied to does not exist.',
  'Der Name steht schon fest.': 'The name has already been set.',
  'Der Ordnerpfad ist leer.': 'The folder path is empty.',
  'Der Signaturschlüssel des Tokens ist unbekannt.': 'The signing key of the token is unknown.',
  'Der externe API-Zugriff ist abgeschaltet.': 'External API access is switched off.',
  'Der externe API-Zugriff ist für diesen Workspace abgeschaltet.':
    'External API access is switched off for this workspace.',
  'Der externe API-Zugriff ist für diesen Workspace abgeschaltet. Ein Administrator kann ihn in den Einstellungen unter „API-Zugriff" freigeben.':
    'External API access is switched off for this workspace. An administrator can enable it in the settings under “API access”.',
  'Die Anmeldung über Microsoft 365 ist nicht eingerichtet.':
    'Sign-in via Microsoft 365 is not set up.',
  'Die Antwort von Microsoft passt nicht zum Anmeldevorgang.':
    'The response from Microsoft does not match the sign-in attempt.',
  'Die Bitrate ist keine Zahl.': 'The bitrate is not a number.',
  'Die Datei fehlt in der Ablage.': 'The file is missing from storage.',
  'Die Datei ist auf dem Server nicht (mehr) vorhanden.':
    'The file is not (or no longer) present on the server.',
  'Die Datei ist kein PNG.': 'The file is not a PNG.',
  'Die Datei ist leer.': 'The file is empty.',
  'Die Dateigröße muss größer als 0 sein.': 'The file size must be greater than 0.',
  'Die Formatauswahl ist ausgeschaltet.': 'The choice of formats is switched off.',
  'Die Kopplung ist abgelaufen. Bitte neu starten.': 'The pairing has expired. Please start again.',
  'Die Kopplung ist ungültig geworden. Bitte neu starten.':
    'The pairing has become invalid. Please start again.',
  'Die Verbindung wurde abgelehnt.': 'The connection was declined.',
  'Die kurze Kante ist keine Zahl.': 'The short edge is not a number.',
  'Die letzte Version eines Videos kann nicht gelöscht werden – bitte das Video löschen.':
    'The last version of a video cannot be deleted – please delete the video instead.',
  'Die lokale Anmeldung lässt sich erst abschalten, wenn Microsoft 365 aktiv und vollständig eingerichtet ist – sonst sperrst du dich aus.':
    'Local sign-in can only be switched off once Microsoft 365 is active and fully configured – otherwise you would lock yourself out.',
  'Die Übertragung wurde unterbrochen.': 'The transfer was interrupted.',
  'Diese Adresse gehört zu einem Gastzugang. Bitte den Freigabe-Link benutzen.':
    'This address belongs to a guest account. Please use the share link.',
  'Diese Adresse gehört zu einem Team-Konto. Bitte über die normale Anmeldung einloggen.':
    'This address belongs to a team account. Please use the normal sign-in.',
  'Diese Art gibt es nicht.': 'This kind does not exist.',
  'Diese E-Mail-Adresse wird bereits verwendet.': 'This email address is already in use.',
  'Diese Einbettung gibt es nicht (mehr).': 'This embed does not exist (any more).',
  'Diese Fassung gehört nicht zu dieser Einbettung.':
    'This version does not belong to this embed.',
  'Diese Fassung ist noch nicht fertig verarbeitet.': 'This version has not finished processing.',
  'Diese Fassung ist noch nicht fertig.': 'This version is not ready yet.',
  'Diese Fassung wurde bereits aufgenommen.': 'This version has already been created.',
  'Diese Freigabe gibt es nicht.': 'This share does not exist.',
  'Diese Freigabe ist abgelaufen oder wurde zurückgezogen.':
    'This share has expired or was withdrawn.',
  'Diese Kopplung gibt es nicht.': 'There is no such pairing.',
  'Diese Person steht nicht im Team.': 'This person is not on the team.',
  'Diese Sicherung gibt es nicht.': 'This backup does not exist.',
  'Diese Sitzung wurde abgebrochen.': 'This session was aborted.',
  'Diese Upload-Sitzung gehört nicht zu einer Fassung.':
    'This upload session does not belong to a version.',
  'Diese Upload-Sitzung wurde abgebrochen.': 'This upload session was aborted.',
  'Dieser Abmelde-Link ist ungültig.': 'This unsubscribe link is not valid.',
  'Dieser Code stimmt nicht.': 'That code is not right.',
  'Dieser Gast gehört weder zu diesem Projekt noch zu einem Projekt desselben Kunden.':
    'This guest belongs neither to this project nor to a project of the same client.',
  'Dieser Gast hat in diesem Projekt keinen Zugang.':
    'This guest has no access in this project.',
  'Dieser Gast ist an der Freigabe nicht eingetragen.':
    'This guest is not listed on the share.',
  'Dieser Gast kommt nicht über diesen Link herein.': 'This guest does not come in via this link.',
  'Dieser Upload ist bereits abgeschlossen.': 'This upload has already been completed.',
  'Dieser Upload ist bereits vollständig.': 'This upload is already complete.',
  'Dieser Zugang steht nicht mehr offen.': 'This access is no longer open.',
  'Dieser Zugang wurde gesperrt.': 'This access has been blocked.',
  'Dieses Format gibt es nicht (mehr).': 'This format does not exist (any more).',
  'Dieses Gerät gibt es nicht.': 'There is no such device.',
  'Dieses Konto gibt es nicht mehr.': 'This account no longer exists.',
  'Dieses Konto ist gesperrt.': 'This account is blocked.',
  'Dieses Projekt ist archiviert – es lässt sich noch ansehen, aber nicht mehr kommentieren.':
    'This project is archived – it can still be watched, but not commented on.',
  'E-Mail-Adresse oder Passwort ist falsch.': 'Email address or password is wrong.',
  'Ein Gast lässt sich nicht ins Team aufnehmen – Gäste melden sich per Code an, das Team mit Passwort oder Microsoft 365. Für einen echten Kollegen bitte unter „Benutzer" ein eigenes Konto anlegen.':
    'A guest cannot be moved onto the team – guests sign in with a code, the team with a password or Microsoft 365. For an actual colleague please create a separate account under “Users”.',
  'Ein Ordnername ist leer.': 'One of the folder names is empty.',
  'Ein Ordnername ist zu lang.': 'One of the folder names is too long.',
  'Ein Schlagwort braucht einen Namen.': 'A tag needs a name.',
  'Ein abgeschlossener Upload kann nicht abgebrochen werden.':
    'A completed upload cannot be aborted.',
  'Eines der Felder gibt es nicht mehr.': 'One of the fields no longer exists.',
  'Es ist kein Mailserver eingerichtet. Ein Administrator kann das unter Einstellungen nachholen.':
    'No mail server is set up. An administrator can add one under Settings.',
  'Es läuft bereits eine Sicherung.': 'A backup is already running.',
  'Es muss mindestens ein aktiver Administrator übrig bleiben.':
    'At least one active administrator has to remain.',
  'Es wurde kein Video ausgewählt.': 'No video was selected.',
  'Es wurden zu viele Codes angefordert. Bitte in einer Stunde erneut versuchen.':
    'Too many codes have been requested. Please try again in an hour.',
  'Externer Projektadmin geht nur über eine Projektfreigabe, nicht über eine einzelne Videofreigabe.':
    'External project admin only works through a project share, not through a single video share.',
  'Feld nicht gefunden.': 'Field not found.',
  'Freigabe nicht gefunden.': 'Share not found.',
  'Fremde Geräte darf nur ein Administrator trennen.':
    'Only an administrator may disconnect other people’s devices.',
  'Für Team-Konten ist nur die Anmeldung über Microsoft 365 erlaubt.':
    'For team accounts only sign-in via Microsoft 365 is allowed.',
  'Für das Hochladen neuer Videofassungen fehlen die Rechte.':
    'You do not have the rights to upload new video versions.',
  'Für diese Aktion fehlen die Rechte.': 'You do not have the rights for this action.',
  'Für diese Fassung gibt es keine adaptive Wiedergabe.':
    'There is no adaptive playback for this version.',
  'Für diese Fassung gibt es noch keine Abspielfassung.':
    'There is no playback version for this version yet.',
  'Für diese Fassung ist kein Download freigegeben.':
    'No download is enabled for this version.',
  'Für diese Freigabe ist das Hochladen nicht erlaubt.':
    'Uploading is not allowed for this share.',
  'Für diese Freigabe ist das Kommentieren nicht erlaubt.':
    'Commenting is not allowed for this share.',
  'Für diese Version gibt es noch keinen Proxy.': 'There is no proxy for this version yet.',
  'Für diesen Upload läuft bereits eine Übertragung.':
    'A transfer is already running for this upload.',
  'Für diesen Workspace gibt es kein App-Symbol.': 'This workspace has no app icon.',
  'Für diesen Workspace gibt es kein Logo.': 'This workspace has no logo.',
  'Für diesen Workspace gibt es kein eigenes Symbol.': 'This workspace has no icon of its own.',
  'Für diesen Zugang ist derzeit nichts freigegeben. Bitte frage nach einem neuen Link.':
    'Nothing is currently shared with this access. Please ask for a new link.',
  'Für dieses Projekt gibt es keine Freigaben.': 'There are no shares for this project.',
  'Für eine Projektfreigabe fehlt die Projekt-ID.': 'A project share needs the project ID.',
  'Für eine Videofreigabe fehlt die Video-ID.': 'A video share needs the video ID.',
  'Gastkonto nicht gefunden.': 'Guest account not found.',
  'Gerade ist kein Code frei. Bitte gleich noch einmal probieren.':
    'No code is free right now. Please try again in a moment.',
  'In diesem Ordner liegen keine Dateien.': 'There are no files in this folder.',
  'Kein Posterframe vorhanden.': 'No poster frame available.',
  'Kein Projekt trägt diesen Kundennamen.': 'No project carries this client name.',
  'Kein Standbild vorhanden.': 'No still frame available.',
  'Keine Timeline-Vorschau vorhanden.': 'No timeline preview available.',
  'Kommentar nicht gefunden.': 'Comment not found.',
  'Konto existiert nicht mehr oder ist deaktiviert.':
    'The account no longer exists or is deactivated.',
  'Konto nicht gefunden.': 'Account not found.',
  'Microsoft hat keine E-Mail-Adresse mitgeschickt. Bitte im Konto eine hinterlegen.':
    'Microsoft did not send an email address. Please add one to the account.',
  'Mindestens ein Schlagwort gibt es nicht (mehr).':
    'At least one tag does not exist (any more).',
  'Mindestens ein Video gehört nicht zu diesem Projekt.':
    'At least one video does not belong to this project.',
  'Nicht angemeldet.': 'Not signed in.',
  'Nur der Verfasser kann diesen Kommentar ändern.':
    'Only the author can change this comment.',
  'Nur der Wurzelkommentar eines Threads lässt sich erledigen.':
    'Only the root comment of a thread can be marked as done.',
  'Ordner nicht gefunden.': 'Folder not found.',
  'Projekt nicht gefunden.': 'Project not found.',
  'Schlagwort nicht gefunden.': 'Tag not found.',
  'Sitzung abgelaufen oder ungültig.': 'Session expired or invalid.',
  'Unbekannte Stufe.': 'Unknown rung.',
  'Unbekannter Pfad.': 'Unknown path.',
  'Upload-Length bzw. sizeBytes fehlt.': 'Upload-Length or sizeBytes is missing.',
  'Upload-Offset fehlt oder ist ungültig.': 'Upload-Offset is missing or invalid.',
  'Upload-Sitzung nicht gefunden.': 'Upload session not found.',
  'Version nicht gefunden.': 'Version not found.',
  'Video nicht gefunden.': 'Video not found.',
  'Zu diesem Code wartet nichts (mehr). Bitte im Plugin neu starten.':
    'Nothing is waiting for this code (any more). Please start again in the plugin.',
  'Zu dieser Adresse gibt es keinen Gastzugang. Bitte den Freigabe-Link benutzen, den du bekommen hast.':
    'There is no guest access for this address. Please use the share link you were sent.',
  'Zu dieser Freigabe gibt es kein Video.': 'There is no video for this share.',
  'Zu dieser Upload-Sitzung fehlt das Projekt.': 'The project is missing for this upload session.',
  'Zu dieser Upload-Sitzung fehlt das Video.': 'The video is missing for this upload session.',
  'Zu viele Abfragen. Bitte die Kopplung neu starten.':
    'Too many requests. Please start the pairing again.',
  'Zu viele Fehlversuche. Bitte einen neuen Code anfordern.':
    'Too many failed attempts. Please request a new code.',
};

/**
 * Sätze mit eingesetzten Werten. `{}` steht für eine Einsetzung; die Werte
 * werden dem deutschen Satz entnommen und im englischen in derselben
 * Reihenfolge wieder eingesetzt.
 */
export interface MeldungsMuster {
  de: string;
  en: string;
}

export const MUSTER: MeldungsMuster[] = [
  { de: '{} antwortete mit HTTP {}.', en: '{} answered with HTTP {}.' },
  {
    de: 'Das Passwort muss mindestens {} Zeichen lang sein.',
    en: 'The password must be at least {} characters long.',
  },
  {
    de: 'Das Passwort darf höchstens {} Zeichen lang sein.',
    en: 'The password may be at most {} characters long.',
  },
  { de: '{} darf höchstens {} KB groß sein.', en: '{} may be at most {} KB.' },
  {
    de: 'Adressen der Domäne {} sind hier nicht zugelassen.',
    en: 'Addresses of the domain {} are not permitted here.',
  },
  { de: 'Als App-Symbol geht nur PNG – nicht {}.', en: 'Only PNG works as an app icon – not {}.' },
  { de: 'Als Logo gehen {} – nicht {}.', en: 'A logo can be {} – not {}.' },
  { de: 'Als Tab-Symbol gehen {} – nicht {}.', en: 'A tab icon can be {} – not {}.' },
  {
    de: 'Content-Type muss {} sein, war aber {}.',
    en: 'Content-Type has to be {}, but was {}.',
  },
  { de: 'Das App-Symbol darf höchstens {} KB groß sein.', en: 'The app icon may be at most {} KB.' },
  {
    de: 'Das Ende des Zeitfensters ({}) ist keine Uhrzeit (HH:MM).',
    en: 'The end of the time window ({}) is not a time of day (HH:MM).',
  },
  {
    de: 'Das Erkennungsdokument des Tenants ist unvollständig ({}).',
    en: 'The tenant’s discovery document is incomplete ({}).',
  },
  { de: 'Das Logo darf höchstens {} KB groß sein.', en: 'The logo may be at most {} KB.' },
  { de: 'Das Schlagwort „{}" gibt es schon.', en: 'The tag “{}” already exists.' },
  {
    de: 'Das Tab-Symbol darf höchstens {} KB groß sein.',
    en: 'The tab icon may be at most {} KB.',
  },
  {
    de: 'Der Beginn des Zeitfensters ({}) ist keine Uhrzeit (HH:MM).',
    en: 'The start of the time window ({}) is not a time of day (HH:MM).',
  },
  {
    de: 'Der Offset passt nicht. Der Server steht bei {} Byte.',
    en: 'The offset does not match. The server is at {} bytes.',
  },
  { de: 'Der Signaturschlüssel ist unbrauchbar: {}', en: 'The signing key is unusable: {}' },
  {
    de: 'Die Datei ist größer als das erlaubte Maximum von {} Byte.',
    en: 'The file is larger than the permitted maximum of {} bytes.',
  },
  { de: 'Die Sicherung ist fehlgeschlagen: {}', en: 'The backup failed: {}' },
  {
    de: 'Die Wiederherstellung ist fehlgeschlagen: {} — der Stand von vorher liegt als „{}“ bereit.',
    en: 'The restore failed: {} — the previous state is available as “{}”.',
  },
  { de: 'Ein Feld namens „{}“ gibt es schon.', en: 'A field called “{}” already exists.' },
  { de: 'Ein Format namens „{}“ gibt es schon.', en: 'A format called “{}” already exists.' },
  {
    de: 'Entra ID hat das Zugriffstoken abgelehnt: {}',
    en: 'Entra ID rejected the access token: {}',
  },
  {
    de: 'Frame {} liegt hinter dem Ende des Videos ({} Frames).',
    en: 'Frame {} lies past the end of the video ({} frames).',
  },
  {
    de: 'Für {} gibt es hier kein Konto. Ein Administrator muss es zuerst anlegen.',
    en: 'There is no account here for {}. An administrator has to create one first.',
  },
  {
    de: 'Microsoft hat die Anmeldung abgelehnt: {}',
    en: 'Microsoft rejected the sign-in: {}',
  },
  {
    de: 'Zu viele Versuche. Bitte in {} Sekunden noch einmal probieren.',
    en: 'Too many attempts. Please try again in {} seconds.',
  },
  {
    de: '„{}" ist keine Farbe. Erwartet wird eine Hex-Angabe wie {}.',
    en: '“{}” is not a colour. A hex value such as {} is expected.',
  },
  { de: '„{}" gibt es schon.', en: '“{}” already exists.' },
];
