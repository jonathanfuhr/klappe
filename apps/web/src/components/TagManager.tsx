'use client';

import type { TagDto } from '@klappe/shared';
import { MAX_TAG_NAME_LENGTH, TAG_COLORS, colorForTagName } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Schlagworte anlegen, umbenennen, einfärben und löschen (Phase 12).
 *
 * Beim Löschen wird gewarnt, wenn das Schlagwort noch an Projekten hängt –
 * es verschwindet dort mit, und das soll niemanden überraschen.
 *
 * Seit Phase 24 steht das nicht mehr als eigenes Fenster über der Projektliste,
 * sondern fest in den Einstellungen bei den benutzerdefinierten Feldern –
 * direkt unter dem Schalter, der die Schlagworte überhaupt erst einschaltet.
 * Zwei Orte für eine Sache waren einer zu viel.
 */
export function TagManager({ onChanged }: { onChanged?: () => Promise<void> }) {
  const t = useT();
  const [tags, setTags] = useState<TagDto[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTags(await api.listTags());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

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
      await onChanged?.();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('common.createFailed'));
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
      await onChanged?.();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t('common.changeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tag: TagDto) => {
    if (
      tag.projectCount > 0 &&
      !window.confirm(t('tags.deleteConfirm', { name: tag.name, count: tag.projectCount }))
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.deleteTag(tag.id);
      await load();
      await onChanged?.();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t('common.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('tags.managerHint')}
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <input
          className="input"
          placeholder={t('tags.newPlaceholder')}
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
          {t('common.create')}
        </button>
      </div>

      <div className="list">
        {tags.map((tag) => (
          <div className="tagrow" key={tag.id}>
            {/*
             * Name und Farben stehen auf schmalen Schirmen untereinander
             * (Phase 24). Nebeneinander blieben für die Beschriftung noch ein
             * paar Pixel übrig, weil die neun Farbpunkte ihre Breite nicht
             * hergeben – vom Namen war dann nichts mehr zu lesen.
             */}
            <input
              className="input tagrow__name"
              defaultValue={tag.name}
              maxLength={MAX_TAG_NAME_LENGTH}
              aria-label={t('tags.nameLabel', { name: tag.name })}
              onBlur={(event) => {
                const neu = event.target.value.trim();
                if (neu && neu !== tag.name) void change(tag.id, { name: neu });
              }}
            />

            <div className="tagrow__rest">
              <div className="tagrow__colors">
                {TAG_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="tagrow__color"
                    data-active={tag.color === color}
                    style={{ background: color }}
                    title={color}
                    aria-label={t('tags.colorLabel', { color })}
                    onClick={() => void change(tag.id, { color })}
                  />
                ))}
                <button
                  type="button"
                  className="tagrow__color tagrow__color--auto"
                  data-active={tag.color === colorForTagName(tag.name)}
                  title={t('tags.colorAutoTitle')}
                  aria-label={t('tags.colorAutoLabel')}
                  onClick={() => void change(tag.id, { color: '' })}
                >
                  A
                </button>
              </div>

              <span className="faint tagrow__count">
                {t('tags.projectCount', { count: tag.projectCount })}
              </span>

              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void remove(tag)}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}

        {tags.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {t('tags.none')}
          </p>
        ) : null}
      </div>
    </>
  );
}
