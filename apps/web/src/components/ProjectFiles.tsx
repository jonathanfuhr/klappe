'use client';

import type { ProjectFileDto, UserDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, mediaUrl } from '@/lib/api';
import { formatBytes, formatRelative } from '@/lib/format';
import { Uploader } from './Uploader';

interface ProjectFilesProps {
  projectId: string;
  canUpload: boolean;
  currentUser: UserDto | null;
  /** Erhöht sich nach jedem abgeschlossenen Upload und löst ein Nachladen aus. */
  reloadToken?: number;
}

/**
 * Kunden-Upload-Ordner eines Projekts (Phase 7).
 *
 * Das Team sieht alles, was eingegangen ist; ein Gast sieht nur seine eigenen
 * Uploads. Diese Trennung macht schon die API – hier steht nur die Anzeige.
 */
export function ProjectFiles({
  projectId,
  canUpload,
  currentUser,
  reloadToken = 0,
}: ProjectFilesProps) {
  const [files, setFiles] = useState<ProjectFileDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const isTeam = currentUser?.role === 'ADMIN' || currentUser?.role === 'MEMBER';

  const load = useCallback(async () => {
    try {
      setFiles(await api.listProjectFiles(projectId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Kunden-Ordner</h2>
        {files.length > 0 ? <span className="badge">{files.length}</span> : null}
        <span className="muted" style={{ fontSize: 13 }}>
          {isTeam
            ? 'Material, das über Freigabe-Links hochgeladen wurde.'
            : 'Hier kannst du eigenes Material hinterlegen.'}
        </span>
      </div>

      {error ? <div className="notice">{error}</div> : null}

      {canUpload ? (
        <div style={{ marginBottom: 12 }}>
          <Uploader projectId={projectId} target="project-file" />
        </div>
      ) : null}

      {files.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Noch keine Dateien.
        </p>
      ) : (
        <div className="filelist">
          {files.map((file) => (
            <div key={file.id} className="filelist__row">
              <span className="filelist__name">{file.filename}</span>
              <span className="muted mono" style={{ fontSize: 12 }}>
                {formatBytes(file.sizeBytes)}
              </span>
              <div className="shell__spacer" />
              {file.uploadedBy ? (
                <span className="faint" style={{ fontSize: 12 }}>
                  {file.uploadedBy.name}
                </span>
              ) : null}
              <span className="faint" style={{ fontSize: 12 }}>
                {formatRelative(file.createdAt)}
              </span>
              <a className="button button--ghost" href={mediaUrl.projectFile(file.id)} download>
                Laden
              </a>
              {isTeam ? (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    if (!window.confirm(`„${file.filename}“ löschen?`)) return;
                    void api.deleteProjectFile(file.id).then(load);
                  }}
                >
                  Löschen
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
