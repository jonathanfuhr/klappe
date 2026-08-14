/**
 * Was darf jemand sehen?
 *
 * Für Team-Mitglieder ist die Antwort laut Konzept immer „alles“. Für Gäste
 * ergibt sie sich aus den Freigabe-Links, über die sie sich angemeldet haben.
 * Diese Datei enthält nur die Entscheidungen – ohne Datenbank, damit die
 * Regeln einzeln prüfbar sind.
 */
import type { UserRole } from '@klappe/shared';

/** Ein für den Gast wirksamer Freigabe-Link. */
export interface GrantedShare {
  shareLinkId: string;
  scope: 'PROJECT' | 'VIDEO';
  projectId: string;
  /** Nur bei `scope === 'VIDEO'` gesetzt. */
  videoId: string | null;
  allowDownload: boolean;
  allowUpload: boolean;
  allowComments: boolean;
  /**
   * „Externer Projektadmin" (Phase 21) – nur an einer Projektfreigabe
   * überhaupt möglich, an einer Videofreigabe immer `false`.
   */
  projectAdmin: boolean;
  /**
   * Darf interne Fassungen sehen (1.7). Hängt am `projectAdmin`: Ohne ihn
   * bleibt das Recht wirkungslos, und die API lässt es gar nicht erst setzen.
   */
  internalVisible: boolean;
  /**
   * Darf interne Fassungen dem Kunden freigeben (1.7). Setzt `internalVisible`
   * voraus – was man nicht sieht, kann man nicht freigeben.
   */
  internalRelease: boolean;
}

export interface AccessScope {
  role: UserRole;
  /** Team-Mitglieder und Admins sehen den ganzen Workspace. */
  unrestricted: boolean;
  shares: GrantedShare[];
}

export function teamScope(role: UserRole): AccessScope {
  return { role, unrestricted: true, shares: [] };
}

export function guestScope(shares: GrantedShare[]): AccessScope {
  return { role: 'GUEST', unrestricted: false, shares };
}

/**
 * Ein Projekt ist sichtbar, wenn es dafür eine Projektfreigabe gibt – oder
 * eine Videofreigabe für ein Video darin. Im zweiten Fall sieht der Gast nur
 * dieses eine Video, aber eben im Rahmen seines Projekts.
 */
export function canViewProject(scope: AccessScope, projectId: string): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some((share) => share.projectId === projectId);
}

/**
 * Ein Video ist sichtbar, wenn eine Projektfreigabe sein Projekt umfasst
 * (dann auch für später hinzugefügte Videos) oder eine Videofreigabe genau
 * auf dieses Video zeigt.
 */
export function canViewVideo(
  scope: AccessScope,
  video: { id: string; projectId: string },
): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some((share) =>
    share.scope === 'PROJECT' ? share.projectId === video.projectId : share.videoId === video.id,
  );
}

/**
 * Download eines Originals.
 *
 * Für Gäste zählt das Recht am Freigabe-Link – pro Person überschreibbar
 * (Phase 16). Dazu kommt seit Phase 28 die eine verbliebene Einschränkung am
 * Video: „nur Endfassungen". Team-Mitglieder verwalten das Material und
 * kommen immer heran.
 */
export function canDownloadVersion(
  scope: AccessScope,
  input: {
    video: { id: string; projectId: string };
    /** Nur die Endfassung darf raus – Zwischenstände bleiben im Haus. */
    downloadsFinalOnly: boolean;
    versionIsFinal: boolean;
  },
): boolean {
  if (scope.unrestricted) return true;
  if (input.downloadsFinalOnly && !input.versionIsFinal) return false;
  return scope.shares.some(
    (share) =>
      share.allowDownload &&
      (share.scope === 'PROJECT'
        ? share.projectId === input.video.projectId
        : share.videoId === input.video.id),
  );
}

/**
 * Interne Fassungen (Phase 27) sieht das Team – und seit 1.7 der externe
 * Projektadmin, **wenn** sein Link es ausdrücklich erlaubt.
 *
 * Bis 1.6 war das eine Frage der Person: `scope.unrestricted`, fertig. Die
 * Begründung war, „darf verwalten“ und „gehört zum Haus“ seien zwei
 * verschiedene Fragen, und die interne Runde sei der Schritt *vor* dem Kunden.
 * Das stimmt weiterhin – nur ist der Projektadmin in der Praxis oft die
 * Agentur, mit der genau diese Runde gedreht wird. Deshalb bleibt es beim
 * Nein, das jetzt aber je Freigabe aufgehoben werden kann.
 *
 * Damit ist es **keine Frage der Person mehr, sondern des Projekts**: Derselbe
 * Gast kann in einem Projekt hineinsehen und im nächsten nicht. Wer diese
 * Funktion aufruft, muss deshalb sagen, um welches Projekt es geht – ein
 * Aufruf ohne Projekt wäre notgedrungen zu großzügig oder zu streng.
 *
 * Die Zeile, an der die ganze Regel hängt: Wer sie ändert, ändert sie überall –
 * in der Fassungsliste, an der neuesten Fassung, beim Download und beim
 * Kommentieren.
 */
export function canSeeInternalVersions(scope: AccessScope, projectId: string): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some(
    (share) =>
      share.scope === 'PROJECT' &&
      share.projectId === projectId &&
      share.projectAdmin &&
      share.internalVisible,
  );
}

/**
 * Darf **irgendwo** interne Fassungen sehen (1.7).
 *
 * Für den einen Fall, in dem das Projekt noch gar nicht feststeht: Eine
 * Upload-Sitzung entsteht ohne Ziel, Projekt und Video werden erst beim
 * Zuordnen eingetragen. Hier fällt deshalb nur die grobe Absage – die
 * genaue Prüfung folgt beim Zuordnen, wo das Projekt bekannt ist.
 *
 * Dasselbe Muster wie `isProjectAdminAnywhere`, und aus demselben Grund: Ein
 * grobes Ja hier ist ungefährlich, solange das feine Nein später kommt.
 */
export function canSeeInternalVersionsAnywhere(scope: AccessScope): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some(
    (share) => share.scope === 'PROJECT' && share.projectAdmin && share.internalVisible,
  );
}

/**
 * Darf eine interne Fassung dem Kunden freigeben (1.7).
 *
 * Getrennt vom Sehen, weil das zwei verschiedene Traute sind: Hineinsehen
 * heißt mitreden, freigeben heißt entscheiden, was der Endkunde zu sehen
 * bekommt. Wer freigeben darf, muss sehen dürfen – die umgekehrte Richtung
 * gibt es nicht.
 */
export function canReleaseInternalVersions(scope: AccessScope, projectId: string): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some(
    (share) =>
      share.scope === 'PROJECT' &&
      share.projectId === projectId &&
      share.projectAdmin &&
      share.internalVisible &&
      share.internalRelease,
  );
}

/** Kommentieren darf ein Gast nur, wenn der Link es zulässt. */
export function canComment(scope: AccessScope, video: { id: string; projectId: string }): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some(
    (share) =>
      share.allowComments &&
      (share.scope === 'PROJECT'
        ? share.projectId === video.projectId
        : share.videoId === video.id),
  );
}

/**
 * Material in den Kunden-Ordner legen (Phase 7). Das geht nur über eine
 * Projektfreigabe – eine Videofreigabe meint eine einzelne Fassung, nicht
 * das Projekt als Ablage.
 */
export function canUploadToProject(scope: AccessScope, projectId: string): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some(
    (share) => share.allowUpload && share.scope === 'PROJECT' && share.projectId === projectId,
  );
}

/**
 * Darf der Kunden-Ordner überhaupt gesehen werden? Gäste sehen nur ihre
 * eigenen Uploads – fremdes Material anderer Kunden geht sie nichts an.
 */
export function canListAllProjectFiles(scope: AccessScope): boolean {
  return scope.unrestricted;
}

/**
 * „Externer Projektadmin" (Phase 21): ein Gast, dem an einer Projektfreigabe
 * ausdrücklich diese Rolle gegeben wurde. Er darf im Rahmen dieses einen
 * Projekts, was sonst dem Team vorbehalten ist – Videos anlegen, Fassungen
 * hochladen und löschen, weiter freigeben, fremde Kommentare verwalten.
 * Team-Mitglieder sind das ohnehin überall.
 */
export function isProjectAdmin(scope: AccessScope, projectId: string): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some(
    (share) => share.scope === 'PROJECT' && share.projectId === projectId && share.projectAdmin,
  );
}

/**
 * Ist die Person *irgendwo* ein externer Projektadmin? Für Prüfungen, bei
 * denen das Zielprojekt noch nicht feststeht – etwa das Anlegen einer
 * Upload-Sitzung ohne Ziel, das erst beim Zuordnen einem Video zugewiesen
 * wird.
 */
export function isProjectAdminAnywhere(scope: AccessScope): boolean {
  if (scope.unrestricted) return true;
  return scope.shares.some((share) => share.scope === 'PROJECT' && share.projectAdmin);
}

/** Projekte, die ein Gast überhaupt zu Gesicht bekommt. */
export function visibleProjectIds(scope: AccessScope): string[] {
  return [...new Set(scope.shares.map((share) => share.projectId))];
}

/**
 * Videos, die für einen Gast einzeln freigegeben sind. `null` bedeutet:
 * keine Einschränkung auf einzelne Videos innerhalb dieses Projekts – es
 * greift eine Projektfreigabe.
 */
export function visibleVideoIdsForProject(
  scope: AccessScope,
  projectId: string,
): string[] | null {
  if (scope.unrestricted) return null;
  const shares = scope.shares.filter((share) => share.projectId === projectId);
  if (shares.some((share) => share.scope === 'PROJECT')) return null;
  return shares
    .map((share) => share.videoId)
    .filter((videoId): videoId is string => Boolean(videoId));
}
