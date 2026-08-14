import { describe, expect, it } from 'vitest';
import {
  type GrantedShare,
  canComment,
  canDownloadVersion,
  canListAllProjectFiles,
  canReleaseInternalVersions,
  canSeeInternalVersions,
  canUploadToProject,
  canViewProject,
  canViewVideo,
  guestScope,
  isProjectAdmin,
  isProjectAdminAnywhere,
  teamScope,
  visibleProjectIds,
  visibleVideoIdsForProject,
} from './access-scope';

const PROJEKT_A = 'projekt-a';
const PROJEKT_B = 'projekt-b';
const VIDEO_1 = 'video-1';
const VIDEO_2 = 'video-2';

const share = (overrides: Partial<GrantedShare> = {}): GrantedShare => ({
  shareLinkId: 'link-1',
  scope: 'PROJECT',
  projectId: PROJEKT_A,
  videoId: null,
  allowDownload: false,
  allowUpload: false,
  allowComments: true,
  projectAdmin: false,
  internalVisible: false,
  internalRelease: false,
  ...overrides,
});

const videoA1 = { id: VIDEO_1, projectId: PROJEKT_A };
const videoA2 = { id: VIDEO_2, projectId: PROJEKT_A };
const videoB1 = { id: 'video-b1', projectId: PROJEKT_B };

describe('Team-Mitglieder', () => {
  const scope = teamScope('MEMBER');

  it('sehen den ganzen Workspace', () => {
    expect(canViewProject(scope, PROJEKT_B)).toBe(true);
    expect(canViewVideo(scope, videoB1)).toBe(true);
    expect(canComment(scope, videoB1)).toBe(true);
    expect(canUploadToProject(scope, PROJEKT_B)).toBe(true);
    expect(canListAllProjectFiles(scope)).toBe(true);
  });

  it('kommen auch an Zwischenstände heran, die für Gäste gesperrt sind', () => {
    expect(
      canDownloadVersion(scope, {
        video: videoA1,
        downloadsFinalOnly: true,
        versionIsFinal: false,
      }),
    ).toBe(true);
  });

  it('haben keine Einschränkung auf einzelne Videos', () => {
    expect(visibleVideoIdsForProject(scope, PROJEKT_A)).toBeNull();
  });
});

describe('Projektfreigabe', () => {
  const scope = guestScope([share()]);

  it('umfasst alle Videos des Projekts, auch später hinzugefügte', () => {
    expect(canViewProject(scope, PROJEKT_A)).toBe(true);
    expect(canViewVideo(scope, videoA1)).toBe(true);
    expect(canViewVideo(scope, videoA2)).toBe(true);
  });

  it('reicht nicht in andere Projekte', () => {
    expect(canViewProject(scope, PROJEKT_B)).toBe(false);
    expect(canViewVideo(scope, videoB1)).toBe(false);
  });

  it('schränkt die Videoliste nicht ein', () => {
    expect(visibleVideoIdsForProject(scope, PROJEKT_A)).toBeNull();
  });
});

describe('Videofreigabe', () => {
  const scope = guestScope([
    share({ scope: 'VIDEO', videoId: VIDEO_1, projectId: PROJEKT_A }),
  ]);

  it('zeigt nur das freigegebene Video', () => {
    expect(canViewVideo(scope, videoA1)).toBe(true);
    expect(canViewVideo(scope, videoA2)).toBe(false);
  });

  it('macht das Projekt sichtbar, aber nur mit diesem einen Video', () => {
    expect(canViewProject(scope, PROJEKT_A)).toBe(true);
    expect(visibleVideoIdsForProject(scope, PROJEKT_A)).toEqual([VIDEO_1]);
  });

  it('erlaubt keinen Kunden-Upload ins Projekt', () => {
    const mitUpload = guestScope([
      share({ scope: 'VIDEO', videoId: VIDEO_1, allowUpload: true }),
    ]);
    expect(canUploadToProject(mitUpload, PROJEKT_A)).toBe(false);
  });
});

describe('Download-Rechte', () => {
  /** Ohne die Endfassungs-Sperre – dann zählt allein das Recht am Link. */
  const ohneSperre = { downloadsFinalOnly: false, versionIsFinal: false };

  it('braucht das Recht am Link', () => {
    expect(
      canDownloadVersion(guestScope([share({ allowDownload: false })]), {
        video: videoA1,
        ...ohneSperre,
      }),
    ).toBe(false);
    expect(
      canDownloadVersion(guestScope([share({ allowDownload: true })]), {
        video: videoA1,
        ...ohneSperre,
      }),
    ).toBe(true);
  });

  it('sperrt Zwischenstände, wenn nur die Endfassung raus darf (Phase 28)', () => {
    expect(
      canDownloadVersion(guestScope([share({ allowDownload: true })]), {
        video: videoA1,
        downloadsFinalOnly: true,
        versionIsFinal: false,
      }),
    ).toBe(false);
  });

  it('lässt die Endfassung durch, auch wenn die Sperre steht', () => {
    expect(
      canDownloadVersion(guestScope([share({ allowDownload: true })]), {
        video: videoA1,
        downloadsFinalOnly: true,
        versionIsFinal: true,
      }),
    ).toBe(true);
  });

  it('die Sperre ersetzt das Recht am Link nicht', () => {
    expect(
      canDownloadVersion(guestScope([share({ allowDownload: false })]), {
        video: videoA1,
        downloadsFinalOnly: false,
        versionIsFinal: true,
      }),
    ).toBe(false);
  });

  it('gilt nur für das freigegebene Video', () => {
    const scope = guestScope([
      share({ scope: 'VIDEO', videoId: VIDEO_1, allowDownload: true }),
    ]);
    expect(canDownloadVersion(scope, { video: videoA1, ...ohneSperre })).toBe(true);
    expect(canDownloadVersion(scope, { video: videoA2, ...ohneSperre })).toBe(false);
  });
});

describe('Kommentieren', () => {
  it('lässt sich am Link abschalten', () => {
    expect(canComment(guestScope([share({ allowComments: false })]), videoA1)).toBe(false);
    expect(canComment(guestScope([share({ allowComments: true })]), videoA1)).toBe(true);
  });
});

describe('Mehrere Freigaben nebeneinander', () => {
  const scope = guestScope([
    share({ shareLinkId: 'l1', projectId: PROJEKT_A, allowDownload: false }),
    share({ shareLinkId: 'l2', scope: 'VIDEO', projectId: PROJEKT_B, videoId: 'video-b1', allowDownload: true }),
  ]);

  it('summiert die Sichtbarkeit', () => {
    expect(visibleProjectIds(scope).sort()).toEqual([PROJEKT_A, PROJEKT_B]);
    expect(canViewVideo(scope, videoA1)).toBe(true);
    expect(canViewVideo(scope, videoB1)).toBe(true);
  });

  it('nimmt für jedes Ziel das dort geltende Recht', () => {
    expect(
      canDownloadVersion(scope, {
        video: videoA1,
        downloadsFinalOnly: false,
        versionIsFinal: false,
      }),
    ).toBe(false);
    expect(
      canDownloadVersion(scope, {
        video: videoB1,
        downloadsFinalOnly: false,
        versionIsFinal: false,
      }),
    ).toBe(true);
  });

  it('schränkt Projekt B auf das freigegebene Video ein', () => {
    expect(visibleVideoIdsForProject(scope, PROJEKT_A)).toBeNull();
    expect(visibleVideoIdsForProject(scope, PROJEKT_B)).toEqual(['video-b1']);
  });
});

describe('Gast ohne jede Freigabe', () => {
  const scope = guestScope([]);

  it('sieht nichts', () => {
    expect(canViewProject(scope, PROJEKT_A)).toBe(false);
    expect(canViewVideo(scope, videoA1)).toBe(false);
    expect(visibleProjectIds(scope)).toEqual([]);
    expect(visibleVideoIdsForProject(scope, PROJEKT_A)).toEqual([]);
    expect(canListAllProjectFiles(scope)).toBe(false);
  });
});

describe('Externer Projektadmin (Phase 21)', () => {
  it('Team ist überall Projektadmin', () => {
    expect(isProjectAdmin(teamScope('MEMBER'), PROJEKT_A)).toBe(true);
    expect(isProjectAdminAnywhere(teamScope('ADMIN'))).toBe(true);
  });

  it('gilt nur für das Projekt der Projektfreigabe, an der es gesetzt ist', () => {
    const scope = guestScope([share({ projectAdmin: true })]);
    expect(isProjectAdmin(scope, PROJEKT_A)).toBe(true);
    expect(isProjectAdmin(scope, PROJEKT_B)).toBe(false);
    expect(isProjectAdminAnywhere(scope)).toBe(true);
  });

  it('eine Videofreigabe gibt kein Projektadmin-Recht', () => {
    const scope = guestScope([
      { ...share({ scope: 'VIDEO', videoId: VIDEO_1, projectAdmin: true }), projectId: PROJEKT_A },
    ]);
    expect(isProjectAdmin(scope, PROJEKT_A)).toBe(false);
    expect(isProjectAdminAnywhere(scope)).toBe(false);
  });

  it('ein normaler Gast ist nirgends Projektadmin', () => {
    const scope = guestScope([share({ projectAdmin: false })]);
    expect(isProjectAdmin(scope, PROJEKT_A)).toBe(false);
    expect(isProjectAdminAnywhere(scope)).toBe(false);
  });
});

describe('Interne Fassungen (Phase 27, geöffnet in 1.7)', () => {
  it('sieht das Team überall', () => {
    expect(canSeeInternalVersions(teamScope('ADMIN'), PROJEKT_A)).toBe(true);
    expect(canSeeInternalVersions(teamScope('MEMBER'), PROJEKT_B)).toBe(true);
  });

  it('ein gewöhnlicher Gast sieht sie nicht', () => {
    expect(canSeeInternalVersions(guestScope([share()]), PROJEKT_A)).toBe(false);
  });

  it('der Projektadmin allein genügt nicht – das Recht muss am Link stehen', () => {
    // Der Grundsatz aus Phase 27 bleibt: Verwalten dürfen heißt nicht, zum
    // Haus zu gehören. Aufgehoben wird er nur dort, wo jemand es ausdrücklich
    // eingetragen hat.
    const scope = guestScope([share({ projectAdmin: true })]);
    expect(isProjectAdmin(scope, PROJEKT_A)).toBe(true);
    expect(canSeeInternalVersions(scope, PROJEKT_A)).toBe(false);
  });

  it('mit dem Recht am Link sieht der Projektadmin sie', () => {
    const scope = guestScope([share({ projectAdmin: true, internalVisible: true })]);
    expect(canSeeInternalVersions(scope, PROJEKT_A)).toBe(true);
  });

  it('ohne Projektadmin bleibt das Recht wirkungslos', () => {
    // Sonst hinge an einem gewöhnlichen Kundenlink ein Recht, das nur für die
    // Agentur gedacht war.
    const scope = guestScope([share({ projectAdmin: false, internalVisible: true })]);
    expect(canSeeInternalVersions(scope, PROJEKT_A)).toBe(false);
  });

  it('gilt nur für das Projekt, an dessen Link es steht', () => {
    // Der wichtigste Fall überhaupt: Dieselbe Person, zwei Projekte. Bis 1.6
    // war das eine Frage der Person und hätte hier beide Male true ergeben.
    const scope = guestScope([
      share({ projectAdmin: true, internalVisible: true }),
      share({ shareLinkId: 'link-2', projectId: PROJEKT_B, projectAdmin: true }),
    ]);
    expect(canSeeInternalVersions(scope, PROJEKT_A)).toBe(true);
    expect(canSeeInternalVersions(scope, PROJEKT_B)).toBe(false);
  });

  it('eine Videofreigabe trägt das Recht nie', () => {
    const scope = guestScope([
      {
        ...share({ scope: 'VIDEO', videoId: VIDEO_1, projectAdmin: true, internalVisible: true }),
        projectId: PROJEKT_A,
      },
    ]);
    expect(canSeeInternalVersions(scope, PROJEKT_A)).toBe(false);
  });
});

describe('Interne Fassungen freigeben (1.7)', () => {
  it('das Team darf überall', () => {
    expect(canReleaseInternalVersions(teamScope('MEMBER'), PROJEKT_A)).toBe(true);
  });

  it('sehen dürfen heißt noch nicht freigeben dürfen', () => {
    const scope = guestScope([share({ projectAdmin: true, internalVisible: true })]);
    expect(canSeeInternalVersions(scope, PROJEKT_A)).toBe(true);
    expect(canReleaseInternalVersions(scope, PROJEKT_A)).toBe(false);
  });

  it('mit beiden Rechten darf er freigeben', () => {
    const scope = guestScope([
      share({ projectAdmin: true, internalVisible: true, internalRelease: true }),
    ]);
    expect(canReleaseInternalVersions(scope, PROJEKT_A)).toBe(true);
  });

  it('freigeben ohne sehen gibt es nicht', () => {
    // Was man nicht sieht, kann man nicht freigeben. Die API lässt die
    // Kombination gar nicht erst zu – hier steht der zweite Riegel.
    const scope = guestScope([
      share({ projectAdmin: true, internalVisible: false, internalRelease: true }),
    ]);
    expect(canReleaseInternalVersions(scope, PROJEKT_A)).toBe(false);
  });

  it('gilt nur für das Projekt, an dessen Link es steht', () => {
    const scope = guestScope([
      share({ projectAdmin: true, internalVisible: true, internalRelease: true }),
      share({ shareLinkId: 'link-2', projectId: PROJEKT_B, projectAdmin: true }),
    ]);
    expect(canReleaseInternalVersions(scope, PROJEKT_A)).toBe(true);
    expect(canReleaseInternalVersions(scope, PROJEKT_B)).toBe(false);
  });
});
