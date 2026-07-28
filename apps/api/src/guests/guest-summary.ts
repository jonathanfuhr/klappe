/**
 * Aus einzelnen Freigabe-Einträgen wird eine Zeile je Gast.
 *
 * Ein Kunde kommt oft über mehrere Links herein – eine Projektfreigabe und
 * zusätzlich eine Videofreigabe für einen Nachdreh. Für die Übersicht zählt
 * aber die Frage: Was darf diese Person am Ende? Deshalb wird hier
 * zusammengefasst statt aufgezählt.
 *
 * Reine Rechnerei ohne Datenbank, damit die Regel für sich prüfbar bleibt.
 */
import type { GuestAccessDto, GuestAccessLinkDto, ShareScope } from '@klappe/shared';

export interface GuestGrantRow {
  userId: string;
  name: string;
  email: string;
  /** Ein gesperrtes Konto kommt gar nicht erst durch die Anmeldung. */
  userActive: boolean;
  shareLinkId: string;
  label: string | null;
  scope: ShareScope;
  targetName: string;
  allowComments: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  /** Der Link ist weder zurückgezogen noch abgelaufen. */
  linkActive: boolean;
  /** Diesem Gast wurde der Zugriff über genau diesen Link entzogen. */
  revokedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/**
 * Ein Link zählt für die Rechte nur, wenn er selbst gilt, dem Gast nicht
 * entzogen wurde und das Konto nicht gesperrt ist. Alle drei Bedingungen
 * müssen zusammenkommen – genau wie beim tatsächlichen Zugriff.
 */
function counts(row: GuestGrantRow): boolean {
  return row.userActive && row.linkActive && row.revokedAt === null;
}

export function summarizeGuests(rows: GuestGrantRow[]): GuestAccessDto[] {
  const byUser = new Map<string, GuestGrantRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId);
    if (list) list.push(row);
    else byUser.set(row.userId, [row]);
  }

  const summaries: GuestAccessDto[] = [];

  for (const [, group] of byUser) {
    const [first] = group;
    const links: GuestAccessLinkDto[] = group
      .map((row) => ({
        shareLinkId: row.shareLinkId,
        label: row.label,
        scope: row.scope,
        targetName: row.targetName,
        allowComments: row.allowComments,
        allowDownload: row.allowDownload,
        allowUpload: row.allowUpload,
        linkActive: row.linkActive,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      }))
      // Gültige Zugänge zuerst, danach die entzogenen – man sucht in der
      // Regel nach dem, was gerade offen ist.
      .sort((left, right) => {
        const leftOpen = left.linkActive && !left.revokedAt ? 0 : 1;
        const rightOpen = right.linkActive && !right.revokedAt ? 0 : 1;
        if (leftOpen !== rightOpen) return leftOpen - rightOpen;
        return right.lastSeenAt.localeCompare(left.lastSeenAt);
      });

    const wirksam = group.filter(counts);

    summaries.push({
      user: { id: first.userId, name: first.name, email: first.email },
      isActive: first.userActive,
      links,
      canView: wirksam.length > 0,
      canComment: wirksam.some((row) => row.allowComments),
      canDownload: wirksam.some((row) => row.allowDownload),
      canUpload: wirksam.some((row) => row.allowUpload),
      firstSeenAt: new Date(
        Math.min(...group.map((row) => row.firstSeenAt.getTime())),
      ).toISOString(),
      lastSeenAt: new Date(Math.max(...group.map((row) => row.lastSeenAt.getTime()))).toISOString(),
    });
  }

  return summaries.sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}
