'use client';

import type { ProjectFieldDefDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { TagManager } from '@/components/TagManager';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';

/**
 * Einstellungen → Felder (Phase 15): die Definitionen der benutzerdefinierten
 * Projekt-Felder. Was hier angelegt wird, erscheint auf jeder Projektseite als
 * ausfüllbares Feld – eine Projektnummer ist der Anlassfall.
 */
export function FieldsPanel() {
  const [fields, setFields] = useState<ProjectFieldDefDto[]>([]);
  const [neuerName, setNeuerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [umbenennen, setUmbenennen] = useState<ProjectFieldDefDto | null>(null);
  const [loeschen, setLoeschen] = useState<ProjectFieldDefDto | null>(null);
  const [tagsEnabled, setTagsEnabled] = useState(true);

  const load = useCallback(async () => {
    try {
      const [defs, einstellungen] = await Promise.all([
        api.listProjectFields(),
        api.getProjectFieldSettings(),
      ]);
      setFields(defs);
      setTagsEnabled(einstellungen.tagsEnabled);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const anlegen = async () => {
    if (!neuerName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createProjectField(neuerName.trim());
      setNeuerName('');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="page__subtitle">
        Benutzerdefinierte Felder erscheinen auf jeder Projektseite – zum Beispiel eine
        Projektnummer. Die Werte trägt das Team pro Projekt ein.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <form
        className="card"
        style={{ padding: 20 }}
        onSubmit={(event) => {
          event.preventDefault();
          void anlegen();
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="new-field-name">
            Neues Feld
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="new-field-name"
              className="input"
              placeholder="z. B. Projektnummer"
              value={neuerName}
              onChange={(event) => setNeuerName(event.target.value)}
            />
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || !neuerName.trim()}
            >
              Anlegen
            </button>
          </div>
        </div>

        {fields.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Noch keine Felder definiert.
          </p>
        ) : (
          <div className="list" style={{ marginTop: 8 }}>
            {fields.map((field) => {
              /** Ein Schalter am Feld – speichert sofort und lädt neu. */
              const schalter = (
                eigenschaft: 'suggest' | 'filterable' | 'sortable' | 'groupable' | 'showOnTile',
                label: string,
                title: string,
              ) => (
                <label className="switch" title={title}>
                  <input
                    type="checkbox"
                    checked={field[eigenschaft]}
                    onChange={(event) => {
                      void api
                        .updateProjectField(field.id, { [eigenschaft]: event.target.checked })
                        .then(load)
                        .catch(() => setError('Speichern fehlgeschlagen.'));
                    }}
                  />
                  {label}
                </label>
              );

              return (
                <div
                  key={field.id}
                  className="filelist__row"
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ flex: 1 }}>{field.name}</span>
                    <span className="faint" style={{ fontSize: 13 }}>
                      {field.projectCount === 0
                        ? 'unbenutzt'
                        : `an ${field.projectCount} ${field.projectCount === 1 ? 'Projekt' : 'Projekten'}`}
                    </span>
                    <button type="button" className="button" onClick={() => setUmbenennen(field)}>
                      Umbenennen
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      onClick={() => setLoeschen(field)}
                    >
                      Löschen
                    </button>
                  </div>
                  {/* Was das Feld in der Projektliste darf (Phase 22) – plus
                      die Tippvorschläge aus Phase 16. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                    {schalter(
                      'suggest',
                      'Vorschläge',
                      'Beim Eintippen Werte aus den anderen Projekten vorschlagen – für einen Kundennamen hilfreich, für eine einmalige Projektnummer sinnlos.',
                    )}
                    {schalter(
                      'filterable',
                      'Filtern',
                      'Das Feld als Filter über der Projektliste anbieten.',
                    )}
                    {schalter(
                      'sortable',
                      'Sortieren',
                      'Das Feld in der Sortier-Auswahl der Projektliste anbieten.',
                    )}
                    {schalter(
                      'groupable',
                      'Gruppieren',
                      'Das Feld in der Gruppier-Auswahl der Projektliste anbieten.',
                    )}
                    {schalter(
                      'showOnTile',
                      'Auf der Projektkachel',
                      'Den eingetragenen Wert auf der Projektkachel anzeigen.',
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </form>

      {/* Schlagworte sind das zweite, was ein Projekt beschreibt – und seit
          Phase 24 stehen Schalter und Verwaltung beieinander statt in einem
          eigenen Fenster über der Projektliste. */}
      <div className="card" style={{ padding: 20 }}>
        <h2 className="section__title" style={{ marginBottom: 12 }}>
          Schlagworte
        </h2>

        <label className="switch">
          <input
            type="checkbox"
            checked={tagsEnabled}
            onChange={(event) => {
              void api
                .updateProjectFieldSettings({ tagsEnabled: event.target.checked })
                .then((einstellungen) => setTagsEnabled(einstellungen.tagsEnabled))
                .catch(() => setError('Speichern fehlgeschlagen.'));
            }}
          />
          Schlagworte verwenden
        </label>
        <p className="hint">
          Aus heißt: Schlagworte verschwinden aus Filter, Projektkacheln und Projektseiten. Die
          Zuordnungen bleiben gespeichert und kommen beim Wiedereinschalten zurück.
        </p>

        {tagsEnabled ? (
          <div style={{ marginTop: 18, borderTop: '1px solid var(--klappe-border)', paddingTop: 16 }}>
            <TagManager />
          </div>
        ) : null}
      </div>

      {umbenennen ? (
        <RenameFieldDialog
          field={umbenennen}
          onClose={() => setUmbenennen(null)}
          onSaved={async () => {
            setUmbenennen(null);
            await load();
          }}
        />
      ) : null}

      {loeschen ? (
        <Dialog title={`Feld „${loeschen.name}“ löschen?`} onClose={() => setLoeschen(null)}>
          <p>
            {loeschen.projectCount > 0
              ? `Die Einträge an ${loeschen.projectCount} ${
                  loeschen.projectCount === 1 ? 'Projekt' : 'Projekten'
                } gehen dabei verloren.`
              : 'Das Feld ist an keinem Projekt belegt.'}
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
                  await api.deleteProjectField(loeschen.id);
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
    </>
  );
}

function RenameFieldDialog({
  field,
  onClose,
  onSaved,
}: {
  field: ProjectFieldDefDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(field.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Feld umbenennen" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.updateProjectField(field.id, { name: name.trim() });
            await onSaved();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="rename-field-name">
            Name
          </label>
          <input
            id="rename-field-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="hint">Die eingetragenen Werte an den Projekten bleiben erhalten.</p>
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
