'use client';

import type { EmbedLinkDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

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
  const t = useT();
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
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    } finally {
      setGeladen(true);
    }
  }, [videoId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const erzeugen = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await api.createEmbedLink(videoId));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('common.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const zurueckziehen = async () => {
    if (!window.confirm(t('embed.disableConfirm'))) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteEmbedLink(videoId);
      setLink(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('embed.disableFailed'));
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
    <Dialog title={t('embed.title', { name: videoName })} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t('embed.intro', { code: 'iframe' })}
      </p>

      {error ? <div className="notice">{error}</div> : null}

      {/* Vor dem Erzeugen sagen, nicht danach durch eine leere Seite: Ohne
          Endfassung liefert die Einbettung nichts aus. */}
      {!hatEndfassung ? (
        <div className="notice notice--warn">
          <strong>{t('embed.noFinalTitle')}</strong> {t('embed.noFinalBody')}
        </div>
      ) : null}

      {!geladen ? (
        <p className="muted">{t('common.loading')}</p>
      ) : !link ? (
        <>
          <ul className="hint" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>{t('embed.bullet1')}</li>
            <li>{t('embed.bullet2')}</li>
            <li>{t('embed.bullet3', { code: 'iframe' })}</li>
            <li>{t('embed.bullet4')}</li>
          </ul>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void erzeugen()}
            >
              {t('embed.create')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor="embed-snippet">
              {t('embed.snippetLabel')}
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
                {kopiert ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <p className="hint">{t('embed.ratioHint', { code: 'aspect-ratio' })}</p>
          </div>

          <div className="field">
            <span className="field__label">{t('embed.urlLabel')}</span>
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
              {t('embed.disable')}
            </button>
            <div className="shell__spacer" />
            <button type="button" className="button" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
