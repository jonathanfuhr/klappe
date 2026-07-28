'use client';

import type { TagDto } from '@klappe/shared';
import { MAX_TAG_NAME_LENGTH, TAG_COLORS, colorForTagName } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Dialog } from './ui/Dialog';

/**
 * Schlagworte anlegen, umbenennen, einfärben und löschen (Phase 12).
 *
 * Beim Löschen wird gewarnt, wenn das Schlagwort noch an Projekten hängt –
 * es verschwindet dort mit, und das soll niemanden überraschen.
 */
export function TagManager({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [tags, setTags] = useState<TagDto[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTags(await api.listTags());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTag({ name });
      setName('');
      await load();
      await onChanged();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const change = async (id: string, input: { name?: string; color?: string }) => {
    setBusy(true);
    setError(null);
    try {
      await api.updateTag(id, input);
      await load();
      await onChanged();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Ändern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tag: TagDto) => {
    if (
      tag.projectCount > 0 &&
      !window.confirm(
        `„${tag.name}" hängt an ${tag.projectCount} ${
          tag.projectCount === 1 ? 'Projekt' : 'Projekten'
        } und verschwindet dort mit. Trotzdem löschen?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.deleteTag(tag.id);
      await load();
      await onChanged();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Schlagworte" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Schlagworte gelten für den ganzen Workspace – dafür sind sie da: mehrere Projekte
        zusammenzufassen, etwa alle eines Kunden.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <input
          className="input"
          placeholder="Neues Schlagwort …"
          maxLength={MAX_TAG_NAME_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void create();
            }
          }}
        />
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
        >
          Anlegen
        </button>
      </div>

      <div className="list" style={{ maxHeight: 380, overflowY: 'auto' }}>
        {tags.map((tag) => (
          <div className="tagrow" key={tag.id}>
            <input
              className="input"
              style={{ flex: 1 }}
              defaultValue={tag.name}
              maxLength={MAX_TAG_NAME_LENGTH}
              onBlur={(event) => {
                const neu = event.target.value.trim();
                if (neu && neu !== tag.name) void change(tag.id, { name: neu });
              }}
            />

            <div className="tagrow__colors">
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="tagrow__color"
                  data-active={tag.color === color}
                  style={{ background: color }}
                  title={color}
                  aria-label={`Farbe ${color}`}
                  onClick={() => void change(tag.id, { color })}
                />
              ))}
              <button
                type="button"
                className="tagrow__color tagrow__color--auto"
                data-active={tag.color === colorForTagName(tag.name)}
                title="Farbe aus dem Namen ableiten"
                aria-label="Farbe automatisch"
                onClick={() => void change(tag.id, { color: '' })}
              >
                A
              </button>
            </div>

            <span className="faint" style={{ fontSize: 12, minWidth: 62, textAlign: 'right' }}>
              {tag.projectCount} {tag.projectCount === 1 ? 'Projekt' : 'Projekte'}
            </span>

            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void remove(tag)}
            >
              Löschen
            </button>
          </div>
        ))}

        {tags.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Noch keine Schlagworte.
          </p>
        ) : null}
      </div>

      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Dialog>
  );
}
