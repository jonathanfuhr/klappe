'use client';

import type { ShareGuestDto, ShareLinkDto, ShareScope } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { Dialog } from './ui/Dialog';

interface ShareManagerProps {
  scope: ShareScope;
  projectId?: string;
  videoId?: string;
  targetLabel: string;
  onClose: () => void;
}

/**
 * Freigaben verwalten (Phase 6): Links anlegen, Rechte umstellen,
 * zurückziehen und sehen, wer sie benutzt hat.
 */
export function ShareManager({
  scope,
  projectId,
  videoId,
  targetLabel,
  onClose,
}: ShareManagerProps) {
  const [links, setLinks] = useState<ShareLinkDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setLinks(
        scope === 'PROJECT' && projectId
          ? await api.listProjectShares(projectId)
          : videoId
            ? await api.listVideoShares(videoId)
            : [],
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [scope, projectId, videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      await api.createShare({
        scope,
        projectId: scope === 'PROJECT' ? projectId : undefined,
        videoId: scope === 'VIDEO' ? videoId : undefined,
        allowComments: true,
      });
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog title={`Freigaben für ${targetLabel}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {scope === 'PROJECT'
          ? 'Eine Projektfreigabe umfasst alle Videos des Projekts – auch die, die später dazukommen.'
          : 'Eine Videofreigabe zeigt genau dieses eine Video.'}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {loading ? <p className="muted">Wird geladen …</p> : null}

      <div className="list" style={{ maxHeight: 420, overflowY: 'auto' }}>
        {links.map((link) => (
          <ShareRow key={link.id} link={link} onChanged={load} />
        ))}
        {!loading && links.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Noch keine Freigabe. Der Link entsteht erst, wenn du eine anlegst.
          </p>
        ) : null}
      </div>

      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Schließen
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void create()}
          disabled={creating}
        >
          Freigabe-Link erstellen
        </button>
      </div>
    </Dialog>
  );
}

function ShareRow({ link, onChanged }: { link: ShareLinkDto; onChanged: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [embedCopied, setEmbedCopied] = useState(false);
  const [guests, setGuests] = useState<ShareGuestDto[] | null>(null);
  const [busy, setBusy] = useState(false);

  const patch = async (changes: Parameters<typeof api.updateShare>[1]) => {
    setBusy(true);
    try {
      await api.updateShare(link.id, changes);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(einbettSchnipsel(link.embedUrl));
      setEmbedCopied(true);
      setTimeout(() => setEmbedCopied(false), 2000);
    } catch {
      setEmbedCopied(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ohne Zwischenablage-Recht bleibt das Feld zum Markieren stehen.
      setCopied(false);
    }
  };

  return (
    <div className="share" data-inactive={!link.isActive}>
      <div className="toolbar">
        <strong style={{ fontSize: 14 }}>{link.targetName}</strong>
        <span className="badge">{link.scope === 'PROJECT' ? 'Projekt' : 'Video'}</span>
        {link.isDirect ? <span className="badge">direkt</span> : null}
        {link.isActive ? (
          <span className="badge badge--ready">aktiv</span>
        ) : (
          <span className="badge badge--failed">zurückgezogen</span>
        )}
        <div className="shell__spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          angelegt {formatDateTime(link.createdAt)}
        </span>
      </div>

      {/* Eine Direktfreigabe (Phase 18) entsteht durch einen Klick in der
          Gästeliste, nicht durch Verschicken. Ihre Adresse gehört deshalb nicht
          hierher – ein Link, den niemand versenden soll, braucht keinen
          Kopierknopf. Zurückziehen und Rechte setzen geht wie bei jedem
          anderen. */}
      {link.isDirect ? (
        <p className="hint" style={{ margin: '4px 0 10px' }}>
          Direkt in der Gästeliste freigegeben – ohne Link zum Verschicken. Die eingetragenen Gäste
          kommen mit ihrem bestehenden Zugang herein.
        </p>
      ) : (
        <div className="share__url">
          <input className="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button" onClick={() => void copy()}>
            {copied ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      )}

      <div className="share__rights">
        <label className="switch">
          <input
            type="checkbox"
            checked={link.allowDownload}
            disabled={busy}
            onChange={(event) => void patch({ allowDownload: event.target.checked })}
          />
          Download erlaubt
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={link.allowComments}
            disabled={busy}
            onChange={(event) => void patch({ allowComments: event.target.checked })}
          />
          Kommentieren erlaubt
        </label>
        {link.scope === 'PROJECT' ? (
          <label className="switch">
            <input
              type="checkbox"
              checked={link.allowUpload}
              disabled={busy}
              onChange={(event) => void patch({ allowUpload: event.target.checked })}
            />
            Kunden-Upload erlaubt
          </label>
        ) : null}
        <label className="switch">
          <input
            type="checkbox"
            checked={link.embedEnabled}
            disabled={busy}
            onChange={(event) => void patch({ embedEnabled: event.target.checked })}
          />
          Einbetten erlauben
        </label>
      </div>

      {link.embedEnabled ? (
        <div className="share__embed">
          <p className="hint" style={{ marginTop: 0 }}>
            Der eingebettete Player fragt <strong>weder nach Code noch nach Anmeldung</strong> –
            anders geht es in einem fremden <code>iframe</code> nicht, weil Browser dort keine
            Cookies zulassen. Wer die Adresse hat, sieht das Video. Heruntergeladen werden kann
            über diesen Weg nichts.
          </p>
          <div className="share__url">
            <input
              className="input mono"
              readOnly
              value={einbettSchnipsel(link.embedUrl)}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="button" onClick={() => void copyEmbed()}>
              {embedCopied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => {
            if (guests) {
              setGuests(null);
              return;
            }
            void api.listShareGuests(link.id).then(setGuests);
          }}
        >
          {guests ? 'Gäste ausblenden' : `Gäste (${link.guestCount})`}
        </button>
        <div className="shell__spacer" />
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => void patch({ revoked: link.isActive })}
        >
          {link.isActive ? 'Zurückziehen' : 'Wieder freigeben'}
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Diesen Freigabe-Link endgültig löschen?')) return;
            void api.deleteShare(link.id).then(() => onChanged());
          }}
        >
          Löschen
        </button>
      </div>

      {guests ? (
        <div className="filelist">
          {guests.length === 0 ? (
            <div className="filelist__row muted">Noch niemand hat diesen Link benutzt.</div>
          ) : null}
          {guests.map((guest) => (
            <div key={guest.user.id} className="filelist__row">
              <span className="filelist__name">{guest.user.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {guest.user.email}
              </span>
              <div className="shell__spacer" />
              <span className="faint" style={{ fontSize: 12 }}>
                zuletzt {formatRelative(guest.lastSeenAt)}
              </span>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  void api
                    .setShareGuestRevoked(link.id, guest.user.id, !guest.revokedAt)
                    .then(() => api.listShareGuests(link.id))
                    .then(setGuests);
                }}
              >
                {guest.revokedAt ? 'Zugriff geben' : 'Zugriff entziehen'}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Fertig zum Einfügen. 16:9 über `aspect-ratio`, damit der Rahmen auf jeder
 * Seite die richtige Höhe bekommt – eine feste Höhe in Pixeln wäre auf einem
 * Telefon zu hoch und auf einer breiten Seite zu niedrig.
 */
function einbettSchnipsel(embedUrl: string | null): string {
  if (!embedUrl) return '';
  return `<iframe src="${embedUrl}" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`;
}
