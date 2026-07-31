'use client';

import type { ProjectFileDto, ProjectFolderDto, UserDto } from '@klappe/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { Dialog } from '@/components/ui/Dialog';
import { Menu, MenuItem } from '@/components/ui/Menu';
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
 * Der Kunden-Bereich eines Projekts – seit Phase 15 eine echte Ordnerstruktur
 * mit Unterordnern, Ordner-Upload und ZIP-Download, gedacht wie ein geteilter
 * Nextcloud-Ordner: Wer Zugang zum Projekt hat, sieht alles darin.
 */
export function ProjectFiles({
  projectId,
  canUpload,
  currentUser,
  reloadToken = 0,
}: ProjectFilesProps) {
  const [files, setFiles] = useState<ProjectFileDto[]>([]);
  const zeigeName = useUserName();
  const [folders, setFolders] = useState<ProjectFolderDto[]>([]);
  const [aktuellerOrdner, setAktuellerOrdner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [neuerOrdner, setNeuerOrdner] = useState(false);
  const [umbenennen, setUmbenennen] = useState<ProjectFolderDto | null>(null);
  const [loeschen, setLoeschen] = useState<ProjectFolderDto | null>(null);
  const isTeam = currentUser?.role === 'ADMIN' || currentUser?.role === 'MEMBER';

  const load = useCallback(async () => {
    try {
      const [dateien, ordner] = await Promise.all([
        api.listProjectFiles(projectId),
        api.listProjectFolders(projectId),
      ]);
      setFiles(dateien);
      setFolders(ordner);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  /** Brotkrumen vom aktuellen Ordner zurück zur Wurzel. */
  const pfad = useMemo(() => {
    const nachId = new Map(folders.map((ordner) => [ordner.id, ordner]));
    const kette: ProjectFolderDto[] = [];
    let aktuell = aktuellerOrdner ? nachId.get(aktuellerOrdner) : undefined;
    for (let tiefe = 0; aktuell && tiefe < 50; tiefe += 1) {
      kette.unshift(aktuell);
      aktuell = aktuell.parentId ? nachId.get(aktuell.parentId) : undefined;
    }
    return kette;
  }, [folders, aktuellerOrdner]);

  // Verschwindet der Ordner (gelöscht, Projektwechsel), zurück zur Wurzel.
  useEffect(() => {
    if (aktuellerOrdner && !folders.some((ordner) => ordner.id === aktuellerOrdner)) {
      setAktuellerOrdner(null);
    }
  }, [folders, aktuellerOrdner]);

  const sichtbareOrdner = folders.filter((ordner) => ordner.parentId === aktuellerOrdner);
  const sichtbareDateien = files.filter((datei) => datei.folderId === aktuellerOrdner);
  const dateienImOrdnerzweig = aktuellerOrdner === null;

  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">Kunden-Ordner</h2>
        {files.length > 0 ? <span className="badge">{files.length}</span> : null}
        <span className="muted" style={{ fontSize: 13 }}>
          {isTeam
            ? 'Material, das über Freigabe-Links hochgeladen wurde.'
            : 'Hier kannst du Material mit uns austauschen.'}
        </span>
        <div className="shell__spacer" />
        {canUpload || isTeam ? (
          <button type="button" className="button" onClick={() => setNeuerOrdner(true)}>
            Neuer Ordner
          </button>
        ) : null}
        {files.length > 0 ? (
          <a
            className="button"
            href={mediaUrl.projectFilesZip(projectId, aktuellerOrdner)}
            title={
              aktuellerOrdner
                ? 'Diesen Ordner samt Unterordnern als ZIP laden'
                : 'Den ganzen Kunden-Ordner als ZIP laden'
            }
          >
            Alles laden (ZIP)
          </a>
        ) : null}
      </div>

      {error ? <div className="notice">{error}</div> : null}

      {pfad.length > 0 ? (
        <div className="breadcrumb" style={{ marginBottom: 10 }}>
          <button type="button" className="button button--ghost" onClick={() => setAktuellerOrdner(null)}>
            Kunden-Ordner
          </button>
          {pfad.map((ordner, index) => (
            <span key={ordner.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span>/</span>
              {index === pfad.length - 1 ? (
                <span>{ordner.name}</span>
              ) : (
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setAktuellerOrdner(ordner.id)}
                >
                  {ordner.name}
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}

      {canUpload ? (
        <div style={{ marginBottom: 12 }}>
          <Uploader projectId={projectId} folderId={aktuellerOrdner ?? undefined} />
        </div>
      ) : null}

      {sichtbareOrdner.length === 0 && sichtbareDateien.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          {dateienImOrdnerzweig ? 'Noch keine Dateien.' : 'Dieser Ordner ist leer.'}
        </p>
      ) : (
        <div className="filelist">
          {sichtbareOrdner.map((ordner) => (
            <div key={ordner.id} className="filelist__row">
              <button
                type="button"
                className="filelist__name"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                  padding: 0,
                }}
                onClick={() => setAktuellerOrdner(ordner.id)}
              >
                📁 {ordner.name}
              </button>
              <div className="shell__spacer" />
              <span className="faint" style={{ fontSize: 12 }}>
                {formatRelative(ordner.createdAt)}
              </span>
              {isTeam ? (
                <Menu label={`Aktionen für Ordner ${ordner.name}`}>
                  <MenuItem onSelect={() => setUmbenennen(ordner)}>Umbenennen …</MenuItem>
                  <MenuItem danger onSelect={() => setLoeschen(ordner)}>
                    Löschen …
                  </MenuItem>
                </Menu>
              ) : null}
            </div>
          ))}

          {sichtbareDateien.map((file) => (
            <div key={file.id} className="filelist__row">
              <span className="filelist__name">{file.filename}</span>
              <span className="muted mono" style={{ fontSize: 12 }}>
                {formatBytes(file.sizeBytes)}
              </span>
              <div className="shell__spacer" />
              {file.uploadedBy ? (
                <span className="faint" style={{ fontSize: 12 }}>
                  {zeigeName(file.uploadedBy)}
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

      {neuerOrdner ? (
        <NewFolderDialog
          projectId={projectId}
          parentId={aktuellerOrdner}
          onClose={() => setNeuerOrdner(false)}
          onCreated={async () => {
            setNeuerOrdner(false);
            await load();
          }}
        />
      ) : null}

      {umbenennen ? (
        <RenameFolderDialog
          folder={umbenennen}
          onClose={() => setUmbenennen(null)}
          onSaved={async () => {
            setUmbenennen(null);
            await load();
          }}
        />
      ) : null}

      {loeschen ? (
        <Dialog title={`Ordner „${loeschen.name}“ löschen?`} onClose={() => setLoeschen(null)}>
          <p>
            Der Ordner verschwindet mit allen Unterordnern und Dateien darin. Das lässt sich nicht
            rückgängig machen.
          </p>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={() => setLoeschen(null)}>
              Abbrechen
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={async () => {
                try {
                  await api.deleteProjectFolder(loeschen.id);
                  setLoeschen(null);
                  await load();
                } catch (deleteError) {
                  setError(
                    deleteError instanceof Error ? deleteError.message : 'Löschen fehlgeschlagen.',
                  );
                  setLoeschen(null);
                }
              }}
            >
              Endgültig löschen
            </button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

function NewFolderDialog({
  projectId,
  parentId,
  onClose,
  onCreated,
}: {
  projectId: string;
  parentId: string | null;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Neuer Ordner" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.ensureProjectFolderPath(projectId, {
              parentId: parentId ?? undefined,
              path: [name.trim()],
            });
            await onCreated();
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="new-folder-name">
            Name
          </label>
          <input
            id="new-folder-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error ? <div className="notice">{error}</div> : null}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
            Anlegen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameFolderDialog({
  folder,
  onClose,
  onSaved,
}: {
  folder: ProjectFolderDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Ordner umbenennen" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.renameProjectFolder(folder.id, name.trim());
            await onSaved();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="rename-folder-name">
            Name
          </label>
          <input
            id="rename-folder-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error ? <div className="notice">{error}</div> : null}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
            Speichern
          </button>
        </div>
      </form>
    </Dialog>
  );
}
