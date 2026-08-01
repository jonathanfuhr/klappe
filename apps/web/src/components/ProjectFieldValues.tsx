'use client';

import type { FieldValueCountDto, ProjectDto, ProjectFieldDefDto } from '@klappe/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Die benutzerdefinierten Felder auf der Projektseite (Phase 15). Zeigt alle
 * Definitionen aus den Einstellungen, vorbelegt mit den Werten des Projekts.
 * Gespeichert wird gesammelt – ein leeres Feld löscht den Eintrag.
 *
 * Gäste sehen die belegten Werte nur lesend; ohne Definitionen erscheint der
 * Abschnitt gar nicht.
 */
export function ProjectFieldValues({
  project,
  isTeam,
  onChanged,
}: {
  project: ProjectDto;
  isTeam: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const [defs, setDefs] = useState<ProjectFieldDefDto[]>([]);
  const [vorschlaege, setVorschlaege] = useState<Record<string, FieldValueCountDto[]>>({});
  const [werte, setWerte] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const vorbelegung = useMemo(() => {
    const map: Record<string, string> = {};
    for (const feld of project.fields) map[feld.fieldId] = feld.value;
    return map;
  }, [project.fields]);

  const load = useCallback(async () => {
    if (!isTeam) return;
    try {
      const defs = await api.listProjectFields();
      setDefs(defs);
      // Vorschläge nur für Felder, die es wollen (Phase 16).
      const paare = await Promise.all(
        defs
          .filter((def) => def.suggest)
          .map(async (def) => [def.id, await api.listProjectFieldValues(def.id)] as const),
      );
      setVorschlaege(Object.fromEntries(paare));
    } catch {
      // Ohne Definitionen fehlt nur der Abschnitt.
      setDefs([]);
    }
  }, [isTeam]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setWerte(vorbelegung);
  }, [vorbelegung]);

  if (!isTeam) {
    if (project.fields.length === 0) return null;
    return (
      <div className="toolbar card" style={{ padding: '8px 14px', flexWrap: 'wrap' }}>
        {project.fields.map((feld) => (
          <span key={feld.fieldId} className="muted" style={{ fontSize: 13 }}>
            {feld.name}: <strong>{feld.value}</strong>
          </span>
        ))}
      </div>
    );
  }

  if (defs.length === 0) return null;

  const geaendert = defs.some((def) => (werte[def.id] ?? '') !== (vorbelegung[def.id] ?? ''));

  return (
    <form
      className="toolbar card"
      style={{ padding: '8px 14px', flexWrap: 'wrap', alignItems: 'flex-end' }}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setInfo(null);
        try {
          await api.setProjectFieldValues(
            project.id,
            defs.map((def) => ({ fieldId: def.id, value: werte[def.id] ?? '' })),
          );
          setInfo(t('common.saved'));
          await onChanged();
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
        } finally {
          setBusy(false);
        }
      }}
    >
      {defs.map((def) => (
        <div key={def.id} className="field" style={{ margin: 0, minWidth: 160 }}>
          <label className="field__label" htmlFor={`projekt-feld-${def.id}`}>
            {def.name}
          </label>
          <input
            id={`projekt-feld-${def.id}`}
            className="input"
            list={def.suggest ? `projekt-feld-vorschlaege-${def.id}` : undefined}
            value={werte[def.id] ?? ''}
            onChange={(event) =>
              setWerte((current) => ({ ...current, [def.id]: event.target.value }))
            }
          />
          {def.suggest ? (
            <datalist id={`projekt-feld-vorschlaege-${def.id}`}>
              {(vorschlaege[def.id] ?? []).map((wert) => (
                <option key={wert.value} value={wert.value} />
              ))}
            </datalist>
          ) : null}
        </div>
      ))}
      {geaendert ? (
        <button type="submit" className="button button--primary" disabled={busy}>
          {t('common.save')}
        </button>
      ) : null}
      {error ? <span className="notice" style={{ margin: 0 }}>{error}</span> : null}
      {info && !geaendert ? (
        <span className="faint" style={{ fontSize: 13 }}>
          {info}
        </span>
      ) : null}
    </form>
  );
}
