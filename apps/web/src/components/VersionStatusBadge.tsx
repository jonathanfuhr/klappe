import type { VersionDto } from '@klappe/shared';

const LABELS: Record<VersionDto['status'], { text: string; className: string }> = {
  UPLOADING: { text: 'Wird hochgeladen', className: 'badge' },
  PROCESSING: { text: 'Wird verarbeitet', className: 'badge badge--processing' },
  READY: { text: 'Bereit', className: 'badge badge--ready' },
  FAILED: { text: 'Fehlgeschlagen', className: 'badge badge--failed' },
};

export function VersionStatusBadge({ version }: { version: VersionDto }) {
  const label = LABELS[version.status];
  return (
    <span className={label.className} title={version.processingError ?? undefined}>
      {label.text}
      {version.status === 'PROCESSING' ? ` ${version.progress} %` : ''}
    </span>
  );
}
