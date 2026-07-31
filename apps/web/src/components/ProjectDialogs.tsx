'use client';

import type { CustomerDto, ProjectDto } from '@klappe/shared';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const [name, setName] = useState(project.name);
  const [customer, setCustomer] = useState(project.customer ?? '');
  const [kunden, setKunden] = useState<CustomerDto[]>([]);

  // Tippvorschläge aus den vorhandenen Kunden (Phase 16).
  useEffect(() => {
    api
      .listCustomers()
      .then(setKunden)
      .catch(() => setKunden([]));
  }, []);
  const [description, setDescription] = useState(project.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t('projectDialog.editTitle')} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.updateProject(project.id, { name, customer, description });
            await onSaved();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="edit-project-name">
            {t('common.name')}
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
            {t('projects.customer')}
          </label>
          <input
            id="edit-project-customer"
            className="input"
            list="edit-project-customer-vorschlaege"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
          <datalist id="edit-project-customer-vorschlaege">
            {kunden.map((eintrag) => (
              <option key={eintrag.name} value={eintrag.name} />
            ))}
          </datalist>
          <p className="hint">{t('projectDialog.customerHint')}</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="edit-project-description">
            {t('projectDialog.description')}
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
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
            {t('common.save')}
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
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t('projectDialog.deleteTitle', { name: project.name })} onClose={onClose}>
      <p>
        {t('projectDialog.deleteBody', {
          count: project.videoCount,
          files:
            project.fileCount > 0
              ? t('projectDialog.deleteFiles', { count: project.fileCount })
              : '',
        })}
      </p>
      {error ? <div className="notice">{error}</div> : null}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          {t('common.cancel')}
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
                deleteError instanceof Error ? deleteError.message : t('common.deleteFailed'),
              );
              setBusy(false);
            }
          }}
        >
          {t('common.deleteFinally')}
        </button>
      </div>
    </Dialog>
  );
}


/**
 * Archivieren und zurückholen (Phase 18).
 *
 * Bewusst mit Nachfrage: Archivieren ist kein Umbenennen. Danach sieht der
 * Kunde nur noch die neueste Fassung, kommentieren geht nicht mehr, und die
 * älteren Fassungen verschwinden nach der eingestellten Frist. Das steht hier
 * im Klartext, samt Frist – wer sie nicht kennt, kann die Folgen nicht
 * abschätzen.
 */
export function ArchiveProjectDialog({
  project,
  onClose,
  onDone,
}: {
  project: ProjectDto;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tage, setTage] = useState<number | null>(null);

  const archiviert = Boolean(project.archivedAt);

  useEffect(() => {
    if (archiviert) return;
    // Nur Admins dürfen die Einstellung lesen; für alle anderen bleibt die
    // Frist hier ungenannt, statt dass der Dialog mit einem Fehler aufmacht.
    api
      .getProjectSettings()
      .then((einstellungen) => setTage(einstellungen.archiveRetentionDays))
      .catch(() => setTage(null));
  }, [archiviert]);

  return (
    <Dialog
      title={
        archiviert
          ? t('projectDialog.unarchiveTitle', { name: project.name })
          : t('projectDialog.archiveTitle', { name: project.name })
      }
      onClose={onClose}
    >
      {archiviert ? (
        <p>{t('projectDialog.unarchiveBody')}</p>
      ) : (
        <>
          <p>
            {t('projectDialog.archiveBodyStart')}{' '}
            <strong>{t('projectDialog.archiveBodyNewest')}</strong>{' '}
            {t('projectDialog.archiveBodyMiddle')}{' '}
            <strong>{t('projectDialog.archiveBodyNoComments')}</strong>.
          </p>
          <p className="hint" style={{ marginTop: 0 }}>
            {tage === null
              ? t('projectDialog.archiveRetentionUnknown')
              : tage === 0
                ? t('projectDialog.archiveRetentionZero')
                : t('projectDialog.archiveRetentionDays', { days: tage })}
          </p>
        </>
      )}

      {error ? <div className="notice">{error}</div> : null}

      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api.setProjectArchived(project.id, !archiviert);
              await onDone();
            } catch (saveError) {
              setError(saveError instanceof Error ? saveError.message : t('projectDialog.failed'));
              setBusy(false);
            }
          }}
        >
          {archiviert ? t('projectDialog.unarchive') : t('projectDialog.archive')}
        </button>
      </div>
    </Dialog>
  );
}
