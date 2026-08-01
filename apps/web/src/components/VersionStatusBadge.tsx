'use client';

import type { VersionDto } from '@klappe/shared';
import { type MessageKey, useT } from '@/lib/i18n';

/**
 * `READY` fehlt hier bewusst: Eine fertige Fassung bekommt kein Abzeichen
 * mehr (siehe unten). Der Typ hält den Eintrag deshalb gar nicht erst offen –
 * sonst stünde dort eine Zeile, die niemand je zu sehen bekommt.
 */
const LABELS: Record<
  Exclude<VersionDto['status'], 'READY'>,
  { key: MessageKey; className: string }
> = {
  UPLOADING: { key: 'versionStatus.uploading', className: 'badge' },
  PROCESSING: { key: 'versionStatus.processing', className: 'badge badge--processing' },
  FAILED: { key: 'versionStatus.failed', className: 'badge badge--failed' },
};

/**
 * Der Verarbeitungsstand – aber nur, solange er etwas aussagt (Phase 28).
 *
 * `READY` stand vorher als „Bereit" neben jedem Titel. Eine Fassung, die man
 * gerade ansieht, ist zwangsläufig fertig; das Abzeichen war eine Zeile, die
 * immer dasselbe sagte. Übrig bleiben die Fälle, in denen es etwas zu
 * berichten gibt: lädt noch, rechnet noch, ist gescheitert.
 */
export function VersionStatusBadge({ version }: { version: VersionDto }) {
  const t = useT();
  if (version.status === 'READY') return null;
  const label = LABELS[version.status];
  return (
    <span className={label.className} title={version.processingError ?? undefined}>
      {t(label.key)}
      {version.status === 'PROCESSING' ? ` ${version.progress} %` : ''}
    </span>
  );
}
