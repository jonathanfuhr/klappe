'use client';

import type { VersionDto } from '@klappe/shared';
import { type MessageKey, useT } from '@/lib/i18n';

const LABELS: Record<VersionDto['status'], { key: MessageKey; className: string }> = {
  UPLOADING: { key: 'versionStatus.uploading', className: 'badge' },
  PROCESSING: { key: 'versionStatus.processing', className: 'badge badge--processing' },
  READY: { key: 'versionStatus.ready', className: 'badge badge--ready' },
  FAILED: { key: 'versionStatus.failed', className: 'badge badge--failed' },
};

export function VersionStatusBadge({ version }: { version: VersionDto }) {
  const t = useT();
  const label = LABELS[version.status];
  return (
    <span className={label.className} title={version.processingError ?? undefined}>
      {t(label.key)}
      {version.status === 'PROCESSING' ? ` ${version.progress} %` : ''}
    </span>
  );
}
