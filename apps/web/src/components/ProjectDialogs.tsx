'use client';

import type { ProjectDto } from '@klappe/shared';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';

/** Name, Kunde und Beschreibung ändern – vom „…“-Menü der Kachel (Phase 15). */
export function EditProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [customer, setCustomer] = useState(project.customer ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Projekt bearbeiten" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.updateProject(project.id, { name, customer, description });
            await onSaved();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="edit-project-name">
            Name
          </label>
          <input
            id="edit-project-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="edit-project-customer">
            Kunde
          </label>
          <input
            id="edit-project-customer"
            className="input"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
          <p className="hint">Leer lassen, um den Kundeneintrag zu entfernen.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="edit-project-description">
            Beschreibung
          </label>
          <textarea
            id="edit-project-description"
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
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

/** Löschen mit Ansage dessen, was mit verschwindet – wie bei den Fassungen. */
export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: ProjectDto;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={`„${project.name}“ löschen?`} onClose={onClose}>
      <p>
        Das Projekt verschwindet mit allen {project.videoCount}{' '}
        {project.videoCount === 1 ? 'Video' : 'Videos'}, sämtlichen Fassungen, Kommentaren,
        Freigabe-Links{project.fileCount > 0 ? ` und ${project.fileCount} Dateien im Kunden-Ordner` : ''}.
        Das lässt sich nicht rückgängig machen.
      </p>
      {error ? <div className="notice">{error}</div> : null}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.deleteProject(project.id);
              await onDeleted();
            } catch (deleteError) {
              setError(
                deleteError instanceof Error ? deleteError.message : 'Löschen fehlgeschlagen.',
              );
              setBusy(false);
            }
          }}
        >
          Endgültig löschen
        </button>
      </div>
    </Dialog>
  );
}

