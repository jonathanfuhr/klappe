'use client';

import type { ProjectFieldDefDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
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
            {fields.map((field) => (
              <div key={field.id} className="filelist__row">
                <span style={{ flex: 1 }}>{field.name}</span>
                <span className="faint" style={{ fontSize: 13 }}>
                  {field.projectCount === 0
                    ? 'unbenutzt'
                    : `an ${field.projectCount} ${field.projectCount === 1 ? 'Projekt' : 'Projekten'}`}
                </span>
                <label
                  className="switch"
                  title="Beim Eintippen Werte aus den anderen Projekten vorschlagen – für einen Kundennamen hilfreich, für eine einmalige Projektnummer sinnlos."
                >
                  <input
                    type="checkbox"
                    checked={field.suggest}
                    onChange={(event) => {
                      void api
                        .updateProjectField(field.id, { suggest: event.target.checked })
                        .then(load)
                        .catch(() => setError('Speichern fehlgeschlagen.'));
                    }}
                  />
                  Vorschläge
                </label>
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
            ))}
          </div>
        )}
      </form>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
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
        <p className="hint" style={{ marginBottom: 0 }}>
          Aus heißt: Schlagworte verschwinden aus Filterleiste, Projektkacheln und Projektseiten.
          Die Zuordnungen bleiben gespeichert und kommen beim Wiedereinschalten zurück.
        </p>
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
