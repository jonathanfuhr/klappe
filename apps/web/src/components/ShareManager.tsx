'use client';

import type { GuestCandidateDto, ShareGuestDto, ShareLinkDto, ShareScope } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { Dialog } from './ui/Dialog';

interface ShareManagerProps {
  scope: ShareScope;
  projectId?: string;
  videoId?: string;
  targetLabel: string;
  onClose: () => void;
  /**
   * Ohne Team-Rechte (externer Projektadmin, Phase 21) gibt es nur die
   * Kurzfassung: Liste ansehen, neuen Link anlegen und kopieren. Rechte
   * umstellen, zurückziehen, löschen und „Bekannte Gäste“ bleiben dem Team
   * vorbehalten – die zugehörigen Endpunkte weisen einen Projektadmin ohnehin
   * ab, das hier erspart nur den fehlgeschlagenen Versuch.
   */
  canManage?: boolean;
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
  canManage = true,
}: ShareManagerProps) {
  const t = useT();
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
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [scope, projectId, videoId, t]);

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
      setError(createError instanceof Error ? createError.message : t('common.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog title={t('shareManager.title', { name: targetLabel })} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        {scope === 'PROJECT'
          ? t('shareManager.introProject')
          : t('shareManager.introVideo')}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {loading ? <p className="muted">{t('common.loading')}</p> : null}

      <div className="list" style={{ maxHeight: 420, overflowY: 'auto' }}>
        {links.map((link) => (
          <ShareRow key={link.id} link={link} onChanged={load} canManage={canManage} />
        ))}
        {!loading && links.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            {t('shareManager.empty')}
          </p>
        ) : null}
      </div>

      {/* Freigeben ohne neuen Link – an Gäste, die den Kunden schon kennen
          (Phase 18, seit Phase 20 auch am einzelnen Video). Braucht das
          Projekt, weil der Kunde daran hängt. Nur fürs Team: Der Kreis
          zieht workspace-weit Gästedaten heran, die ein Projektadmin nicht
          zu sehen bekommt. */}
      {projectId && canManage ? (
        <BekannteGaeste
          projectId={projectId}
          videoId={scope === 'VIDEO' ? videoId : undefined}
          onAdded={load}
        />
      ) : null}

      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          {t('common.close')}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => void create()}
          disabled={creating}
        >
          {t('shareManager.create')}
        </button>
      </div>
    </Dialog>
  );
}

function ShareRow({
  link,
  onChanged,
  canManage,
}: {
  link: ShareLinkDto;
  onChanged: () => Promise<void>;
  canManage: boolean;
}) {
  const t = useT();
  const zeigeName = useUserName();
  const [copied, setCopied] = useState(false);
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
        <span className="badge">{link.scope === 'PROJECT' ? t('shareManager.scopeProject') : t('shareManager.scopeVideo')}</span>
        {link.isDirect ? <span className="badge">{t('shareManager.direct')}</span> : null}
        {link.isActive ? (
          <span className="badge badge--ready">{t('shareManager.active')}</span>
        ) : (
          <span className="badge badge--failed">{t('shareManager.revoked')}</span>
        )}
        <div className="shell__spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {t('shareManager.createdAt', { date: formatDateTime(link.createdAt) })}
        </span>
      </div>

      {/* Eine Direktfreigabe (Phase 18) entsteht durch einen Klick in der
          Gästeliste, nicht durch Verschicken. Ihre Adresse gehört deshalb nicht
          hierher – ein Link, den niemand versenden soll, braucht keinen
          Kopierknopf. Zurückziehen und Rechte setzen geht wie bei jedem
          anderen. */}
      {link.isDirect ? (
        <p className="hint" style={{ margin: '4px 0 10px' }}>
          {t('shareManager.directHint')}
        </p>
      ) : (
        <div className="share__url">
          <input className="input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="button" onClick={() => void copy()}>
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      )}

      {canManage ? (
        <div className="share__rights">
          <label className="switch">
            <input
              type="checkbox"
              checked={link.allowDownload}
              disabled={busy}
              onChange={(event) => void patch({ allowDownload: event.target.checked })}
            />
            {t('shareManager.allowDownload')}
          </label>
          <label className="switch">
            <input
              type="checkbox"
              checked={link.allowComments}
              disabled={busy}
              onChange={(event) => void patch({ allowComments: event.target.checked })}
            />
            {t('shareManager.allowComments')}
          </label>
          {link.scope === 'PROJECT' ? (
            <label className="switch">
              <input
                type="checkbox"
                checked={link.allowUpload}
                disabled={busy}
                onChange={(event) => void patch({ allowUpload: event.target.checked })}
              />
              {t('shareManager.allowUpload')}
            </label>
          ) : null}
        </div>
      ) : (
        // Ohne Team-Rechte nur die Ansicht, kein Umstellen (Phase 21).
        <div className="toolbar" style={{ gap: 6, flexWrap: 'wrap' }}>
          {link.allowDownload ? <span className="badge">{t('shareManager.allowDownload')}</span> : null}
          {link.allowComments ? <span className="badge">{t('shareManager.allowComments')}</span> : null}
          {link.allowUpload ? <span className="badge">{t('shareManager.allowUpload')}</span> : null}
        </div>
      )}


      {canManage ? (
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
            {guests
              ? t('shareManager.hideGuests')
              : t('shareManager.showGuests', { count: link.guestCount })}
          </button>
          <div className="shell__spacer" />
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void patch({ revoked: link.isActive })}
          >
            {link.isActive ? t('shareManager.revoke') : t('shareManager.reactivate')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t('shareManager.deleteConfirm'))) return;
              void api.deleteShare(link.id).then(() => onChanged());
            }}
          >
            {t('common.delete')}
          </button>
        </div>
      ) : null}

      {guests ? (
        <div className="filelist">
          {guests.length === 0 ? (
            <div className="filelist__row muted">{t('shareManager.noGuestsYet')}</div>
          ) : null}
          {guests.map((guest) => (
            <div key={guest.user.id} className="filelist__row">
              <span className="filelist__name">{zeigeName(guest.user)}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {guest.user.email}
              </span>
              <div className="shell__spacer" />
              <span className="faint" style={{ fontSize: 12 }}>
                {t('shareManager.lastSeen', { when: formatRelative(guest.lastSeenAt) })}
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
                {guest.revokedAt ? t('shareManager.grantAccess') : t('shares.revoke')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}


/**
 * An bereits angelegte Gäste freigeben (Phase 18).
 *
 * Wer schon bei einem anderen Projekt desselben Kunden dabei ist, braucht
 * keinen neuen Link und keine neue Anmeldung – ein Klick genügt. Der Kreis
 * bleibt bewusst auf den Kunden beschränkt: Zwei Kunden dürfen nicht
 * versehentlich ineinander rutschen, und eine Liste aller Gäste des Workspace
 * wäre genau die Gelegenheit dazu.
 *
 * Ohne Kunden am Projekt gibt es keinen Kreis – dann steht hier, woran es
 * liegt, statt einer leeren Liste ohne Erklärung.
 */
/**
 * Gäste, die den Kunden schon kennen (Phase 18, seit Phase 20 auch am
 * einzelnen Video).
 *
 * Am Video ist der Kreis derselbe – alle Gäste dieses Kunden –, aber die
 * Frage eine andere: Nicht zur Wahl steht, wer *dieses Video* schon sieht.
 * Wer bisher nur andere Videos desselben Projekts kennt, steht also mit
 * dabei; für ihn ist dieses hier genauso neu wie für jemanden von außerhalb.
 */
function BekannteGaeste({
  projectId,
  videoId,
  onAdded,
}: {
  projectId: string;
  /** Gesetzt heißt: Es geht um dieses eine Video, nicht um das ganze Projekt. */
  videoId?: string;
  onAdded: () => Promise<void>;
}) {
  const t = useT();
  const zeigeName = useUserName();
  const [kandidaten, setKandidaten] = useState<GuestCandidateDto[] | null>(null);
  const [kunde, setKunde] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Bekommt der Gast einen Hinweis per Mail? (Phase 20) */
  const [bescheid, setBescheid] = useState(true);

  const laden = useCallback(async () => {
    try {
      const [liste, projekt] = await Promise.all([
        videoId ? api.listVideoGuestCandidates(videoId) : api.listGuestCandidates(projectId),
        api.getProject(projectId),
      ]);
      setKandidaten(liste);
      setKunde(projekt.customer);
    } catch (loadError) {
      setFehler(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
      setKandidaten([]);
    }
  }, [projectId, videoId, t]);

  useEffect(() => {
    void laden();
  }, [laden]);

  const hinzufuegen = async (userId: string) => {
    setBusy(userId);
    setFehler(null);
    try {
      await api.extendProjectGuest(
        projectId,
        userId,
        videoId
          ? { scope: 'VIDEO', videoIds: [videoId], notify: bescheid }
          : { scope: 'PROJECT', notify: bescheid },
      );
      await Promise.all([laden(), onAdded()]);
    } catch (addError) {
      setFehler(addError instanceof Error ? addError.message : t('shares.shareFailed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="section">
      <div className="section__head">
        <h2 className="section__title">{t('shareManager.knownGuests')}</h2>
        {kandidaten && kandidaten.length > 0 ? (
          <span className="badge">{kandidaten.length}</span>
        ) : null}
      </div>

      {fehler ? <div className="notice">{fehler}</div> : null}

      {!kunde ? (
        <p className="hint" style={{ margin: 0 }}>
          {t('shareManager.noCustomer')}
        </p>
      ) : kandidaten === null ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>
          {t('common.loading')}
        </p>
      ) : kandidaten.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          {videoId
            ? t('shareManager.noneLeftVideo', { customer: kunde })
            : t('shareManager.noneLeftProject', { customer: kunde })}
        </p>
      ) : (
        <>
          <p className="hint" style={{ margin: '0 0 8px' }}>
            {videoId
              ? t('shareManager.candidatesVideo', { customer: kunde })
              : t('shareManager.candidatesProject', { customer: kunde })}{' '}
            {t('shareManager.candidatesRights')}
          </p>

          {/* Sichtbar, bevor der Klick kommt: Sonst ginge unbemerkt Post an den
              Kunden raus (Phase 20). */}
          <label className="switch" style={{ margin: '0 0 8px' }}>
            <input
              type="checkbox"
              checked={bescheid}
              onChange={(event) => setBescheid(event.target.checked)}
            />
            {t('shares.notifyByMail')}
          </label>
          {kandidaten.map((eintrag) => (
            <div key={eintrag.user.id} className="guest">
              <div className="toolbar" style={{ gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{zeigeName(eintrag.user)}</strong>
                <div className="shell__spacer" />
                <button
                  type="button"
                  className="button"
                  disabled={busy === eintrag.user.id}
                  onClick={() => void hinzufuegen(eintrag.user.id)}
                >
                  {videoId ? t('shareManager.shareVideo') : t('shareManager.shareProject')}
                </button>
              </div>
              <span className="faint" style={{ fontSize: 12 }}>
                {t('shareManager.candidateVia', {
                  email: eintrag.user.email,
                  projects: eintrag.fromProjects.map((p) => p.name).join(', '),
                })}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
