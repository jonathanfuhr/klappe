'use client';

import type { VideoDto } from '@klappe/shared';
import { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Video umbenennen – vom „…“-Menü der Kachel und der Videoseite (Phase 15). */
export function EditVideoDialog({
  video,
  onClose,
  onSaved,
}: {
  video: VideoDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(video.name);
  const [description, setDescription] = useState(video.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t('videoDialog.editTitle')} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.updateVideo(video.id, { name, description });
            await onSaved();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="edit-video-name">
            {t('common.name')}
          </label>
          <input
            id="edit-video-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="hint">{t('videoDialog.nameHint')}</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="edit-video-description">
            {t('projectDialog.description')}
          </label>
          <textarea
            id="edit-video-description"
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
export function DeleteVideoDialog({
  video,
  onClose,
  onDeleted,
}: {
  video: VideoDto;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t('videoDialog.deleteTitle', { name: video.name })} onClose={onClose}>
      <p>{t('videoDialog.deleteBody', { count: video.versionCount })}</p>
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
              await api.deleteVideo(video.id);
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
