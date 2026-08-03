'use client';

import type { AworkProjectDto, AworkProjectStateDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Die awork-Zuordnung eines Projekts (Phase 30).
 *
 * Sichtbar nur, wenn die Anbindung läuft – wer awork nicht benutzt, soll auf
 * seiner Projektseite nichts davon sehen. Der Normalfall braucht diese Zeile
 * gar nicht: Die Zuordnung entsteht beim ersten Kommentar von selbst über die
 * Projektnummer. Hier steht sie für die Fälle, in denen das nicht reicht –
 * ein Altprojekt ohne Nummer, zwei Projekte mit derselben, ein abweichender
 * Kundenname.
 */
export function AworkProjectLink({ projectId }: { projectId: string }) {
  const t = useT();
  const [state, setState] = useState<AworkProjectStateDto | null>(null);
  const [auswahl, setAuswahl] = useState<AworkProjectDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api.getAworkProjectState(projectId));
    } catch {
      // Ohne Anbindung antwortet die Route nicht sinnvoll – dann bleibt die
      // Zeile eben weg, statt eine Fehlermeldung ins Projekt zu setzen.
      setState(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state?.enabled) return null;

  const handeln = async (aktion: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await aktion();
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const auswahlLaden = async () => {
    setBusy(true);
    setError(null);
    try {
      setAuswahl(await api.listAworkProjects());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const herkunft =
    state.link?.matchedBy === 'manuell'
      ? t('awork.matchedManual')
      : state.link?.matchedBy === 'angelegt'
        ? t('awork.matchedCreated')
        : t('awork.matchedNumber');

  return (
    <div className="toolbar card" style={{ padding: '8px 14px', flexWrap: 'wrap', gap: 12 }}>
      <strong style={{ fontSize: 13 }}>{t('awork.projectTitle')}</strong>

      {state.link ? (
        <span style={{ fontSize: 13 }}>
          {state.link.aworkProjectName
            ? t('awork.projectLinked', { name: state.link.aworkProjectName })
            : t('awork.projectLinkedUnnamed')}{' '}
          <span className="faint">
            ({herkunft}
            {state.taskCount > 0 ? `, ${t('awork.projectTasks', { count: state.taskCount })}` : ''})
          </span>
        </span>
      ) : (
        <span style={{ fontSize: 13 }}>
          {t('awork.projectNone')}{' '}
          <span className="faint">
            {state.projectNumber
              ? t('awork.projectNumber', { number: state.projectNumber })
              : t('awork.projectNoNumber')}
          </span>
        </span>
      )}

      {error ? (
        <span className="notice notice--warn" style={{ fontSize: 12 }}>
          {error}
        </span>
      ) : null}

      <div className="shell__spacer" />

      {auswahl ? (
        <select
          className="select"
          style={{ minWidth: 220 }}
          disabled={busy}
          defaultValue=""
          onChange={(event) => {
            const wert = event.target.value;
            if (!wert) return;
            setAuswahl(null);
            void handeln(() => api.linkAworkProject(projectId, wert));
          }}
        >
          <option value="">{t('awork.projectPick')}</option>
          {auswahl.map((projekt) => (
            <option key={projekt.id} value={projekt.id}>
              {projekt.projectNumber ? `${projekt.projectNumber} · ` : ''}
              {projekt.name}
              {projekt.company ? ` (${projekt.company})` : ''}
            </option>
          ))}
        </select>
      ) : (
        <>
          {!state.link && state.projectNumber ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void handeln(() => api.resolveAworkProject(projectId))}
            >
              {t('awork.projectSearch')}
            </button>
          ) : null}

          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void auswahlLaden()}
          >
            {t('awork.projectChoose')}
          </button>

          {state.link ? (
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(t('awork.projectUnlinkConfirm'))) return;
                void handeln(() => api.unlinkAworkProject(projectId));
              }}
            >
              {t('awork.projectUnlink')}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
