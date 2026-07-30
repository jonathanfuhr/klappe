'use client';

import type { EmbedLinkDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';

/**
 * Einbetten eines Videos (Phase 23).
 *
 * Bewusst getrennt von den Freigaben: Vorher war Einbetten ein Schalter am
 * gewöhnlichen Freigabe-Link, und damit trug derselbe Link zwei
 * grundverschiedene Bedeutungen – „melde dich an und kommentiere" und „wer
 * die Adresse hat, sieht das Video". Jetzt ist es ein eigener Link, über den
 * sich niemand anmelden kann und der in der Freigabenliste gar nicht
 * auftaucht.
 */
export function EmbedDialog({
  videoId,
  videoName,
  /** Gibt es überhaupt eine Endfassung? Nur die wird ausgeliefert. */
  hatEndfassung,
  onClose,
}: {
  videoId: string;
  videoName: string;
  hatEndfassung: boolean;
  onClose: () => void;
}) {
  const [link, setLink] = useState<EmbedLinkDto | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  const load = useCallback(async () => {
    try {
      setLink(await api.getEmbedLink(videoId));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setGeladen(true);
    }
  }, [videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const erzeugen = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await api.createEmbedLink(videoId));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const zurueckziehen = async () => {
    if (!window.confirm('Die Einbettung sofort abschalten? Der eingebettete Player bleibt dann leer.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteEmbedLink(videoId);
      setLink(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Zurückziehen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const kopieren = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.snippet);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Ohne Zwischenablage-Recht bleibt das Feld zum Markieren stehen.
      setKopiert(false);
    }
  };

  return (
    <Dialog title={`„${videoName}" einbetten`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Ein eigener Link für den <code>iframe</code> auf einer fremden Seite – getrennt von den
        Freigaben. Über ihn kann sich niemand anmelden; er zeigt nur den Player.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      {/* Vor dem Erzeugen sagen, nicht danach durch eine leere Seite: Ohne
          Endfassung liefert die Einbettung nichts aus. */}
      {!hatEndfassung ? (
        <div className="notice notice--warn">
          <strong>Noch keine Endfassung.</strong> Eingebettet wird ausschließlich die neueste
          Fassung mit gesetztem Endfassungs-Haken – eine Einbettung steht auf einer fremden Seite
          und wird dort niemandem erklärt. Solange keine da ist, bleibt der Player leer.
        </div>
      ) : null}

      {!geladen ? (
        <p className="muted">Wird geladen …</p>
      ) : !link ? (
        <>
          <ul className="hint" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Ausgeliefert wird nur die Abspielfassung, nie das Original.</li>
            <li>Keine Kommentare, keine Gästeliste, kein Download.</li>
            <li>
              Wer die Adresse hat, sieht das Video – ein <code>iframe</code> kann keine Anmeldung
              mitbringen, weil Browser dort keine fremden Cookies zulassen.
            </li>
            <li>Zurückziehen wirkt sofort.</li>
          </ul>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void erzeugen()}
            >
              Einbett-Link erzeugen
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor="embed-snippet">
              Zum Einfügen in die fremde Seite
            </label>
            <div className="share__url">
              <input
                id="embed-snippet"
                className="input mono"
                readOnly
                value={link.snippet}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="button" onClick={() => void kopieren()}>
                {kopiert ? 'Kopiert' : 'Kopieren'}
              </button>
            </div>
            <p className="hint">
              Der Rahmen richtet sich über <code>aspect-ratio</code> nach der Breite – eine feste
              Höhe wäre auf dem Telefon zu hoch und auf einer breiten Seite zu niedrig.
            </p>
          </div>

          <div className="field">
            <span className="field__label">Adresse allein</span>
            <input
              className="input"
              readOnly
              value={link.url}
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>

          <div className="dialog__actions">
            <button
              type="button"
              className="button button--danger"
              disabled={busy}
              onClick={() => void zurueckziehen()}
            >
              Einbettung abschalten
            </button>
            <div className="shell__spacer" />
            <button type="button" className="button" onClick={onClose}>
              Schließen
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
