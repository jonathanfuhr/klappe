'use client';

import type { TagDto, TagRefDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { TagChip } from './TagChip';

/**
 * Schlagworte eines Projekts an- und abwählen (Phase 12).
 *
 * Ein neues Schlagwort lässt sich hier direkt anlegen – wer gerade beim
 * Einsortieren ist, soll dafür nicht erst auf die Übersicht wechseln müssen.
 */
export function ProjectTags({
  projectId,
  assigned,
  onChanged,
}: {
  projectId: string;
  assigned: TagRefDto[];
  onChanged: () => Promise<void>;
}) {
  const [all, setAll] = useState<TagDto[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAll(await api.listTags());
    } catch {
      setAll([]);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = async (tagId: string) => {
    const naechste = assigned.some((tag) => tag.id === tagId)
      ? assigned.filter((tag) => tag.id !== tagId).map((tag) => tag.id)
      : [...assigned.map((tag) => tag.id), tagId];

    setBusy(true);
    setError(null);
    try {
      await api.setProjectTags(projectId, naechste);
      await onChanged();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Ändern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const createAndAssign = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const tag = await api.createTag({ name });
      await api.setProjectTags(projectId, [...assigned.map((entry) => entry.id), tag.id]);
      setName('');
      await load();
      await onChanged();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="projecttags">
      <div className="projecttags__row">
        {assigned.map((tag) => (
          <TagChip key={tag.id} tag={tag} small />
        ))}
        <button
          type="button"
          className="button button--ghost"
          onClick={() => setOpen((current) => !current)}
        >
          {assigned.length === 0 ? 'Schlagwort hinzufügen' : 'Schlagworte ändern'}
        </button>
      </div>

      {open ? (
        <div className="projecttags__picker">
          {error ? <div className="notice">{error}</div> : null}

          <div className="filterbar__tags">
            {all.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                active={assigned.some((entry) => entry.id === tag.id)}
                onClick={() => void toggle(tag.id)}
              />
            ))}
            {all.length === 0 ? (
              <span className="faint" style={{ fontSize: 13 }}>
                Noch keine Schlagworte im Workspace.
              </span>
            ) : null}
          </div>

          <div className="toolbar" style={{ marginTop: 10 }}>
            <input
              className="input"
              placeholder="Neues Schlagwort …"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createAndAssign();
                }
              }}
            />
            <button
              type="button"
              className="button"
              disabled={busy || !name.trim()}
              onClick={() => void createAndAssign()}
            >
              Anlegen und zuweisen
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
