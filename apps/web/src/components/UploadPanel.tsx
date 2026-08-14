'use client';

import {
  type ProjectDto,
  type VersionSettingsDto,
  type VideoDto,
  suggestVideoName,
  versionLabel,
} from '@klappe/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { type UploadJob, useUploads } from '@/lib/uploads-context';

/**
 * Das Upload-Fenster (Notion-Nachtrag).
 *
 * Es hängt am Rand der Anwendung, lässt sich einklappen und wieder öffnen und
 * überlebt den Wechsel zwischen Projekten – die Warteschlange liegt im
 * `UploadsProvider` im Wurzel-Layout, nicht in dieser Ansicht.
 *
 * Pro Datei stehen hier Projekt, Video und Datum zur Wahl; die Vorauswahl
 * kommt aus dem Dateinamen und ist als Vorschlag gekennzeichnet.
 */
export function UploadPanel() {
  const { jobs, open, setOpen, update, start, save, unsave, cancel, remove, clearFinished } =
    useUploads();
  const { user } = useSession();
  const t = useT();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [videosByProject, setVideosByProject] = useState<Record<string, VideoDto[]>>({});
  /**
   * Ob und wie interne Fassungen gelten, entscheidet der Workspace (Phase 28).
   * Ohne Antwort bleibt es beim Zurückhaltenden: Haken sichtbar, aber nicht
   * gesetzt – lieber versehentlich nicht veröffentlicht als versehentlich.
   */
  const [fassungen, setFassungen] = useState<VersionSettingsDto | null>(null);

  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';
  const pending = jobs.filter((job) => job.state === 'wartet');
  const active = jobs.filter((job) => job.state === 'lädt' || job.state === 'verarbeitet');

  /**
   * Die Warteschlange in einer Box (1.6.1). Der Takt der Verarbeitungsabfrage
   * darf nicht an ihr hängen – siehe die Begründung weiter unten.
   */
  const jobsRef = useRef<UploadJob[]>(jobs);
  jobsRef.current = jobs;

  useEffect(() => {
    if (jobs.length === 0 || !isTeam) return;
    api
      .listProjects()
      .then(setProjects)
      .catch(() => undefined);
    api
      .getVersionSettings()
      .then(setFassungen)
      .catch(() => undefined);
  }, [jobs.length, isTeam]);

  /**
   * Die Vorgabe des Workspace auf die noch offenen Zeilen anwenden. Nur auf
   * unberührte: Wer den Haken selbst umgelegt hat, soll ihn nicht durch eine
   * verspätete Antwort des Servers wieder verlieren.
   */
  useEffect(() => {
    if (!fassungen?.internalEnabled || !fassungen.internalByDefault) return;
    for (const job of jobs) {
      if (job.target !== 'video' || job.gespeichert || job.internBeruehrt || job.internal) continue;
      update(job.id, { internal: true });
    }
  }, [fassungen, jobs, update]);

  /**
   * Namensvorschlag nachschärfen, sobald das Ziel-Projekt feststeht
   * (Phase 25): Kunden- und Projektname fliegen aus dem Vorschlag – der
   * Download-Dateiname trägt beides ohnehin vor dem Videonamen, sonst stünde
   * es dort doppelt. Nur solange niemand den Namen selbst angefasst hat und
   * die Zeile noch nicht gespeichert ist; ein Projektwechsel rechnet den
   * Vorschlag entsprechend neu.
   */
  useEffect(() => {
    for (const job of jobs) {
      if (job.target !== 'video' || job.videoId || job.nameBeruehrt || job.gespeichert) continue;
      const projekt = projects.find((eintrag) => eintrag.id === job.projectId);
      const vorschlag = suggestVideoName(
        job.filename,
        projekt ? { name: projekt.name, customer: projekt.customer } : undefined,
      );
      if (vorschlag !== job.newVideoName) update(job.id, { newVideoName: vorschlag });
    }
  }, [jobs, projects, update]);

  /** Videos eines Projekts nachladen, sobald es in der Liste auftaucht. */
  useEffect(() => {
    const needed = [...new Set(jobs.map((job) => job.projectId))].filter(
      (projectId) => projectId && !(projectId in videosByProject),
    );
    if (needed.length === 0) return;

    for (const projectId of needed) {
      api
        .listVideos(projectId)
        .then((videos) => setVideosByProject((current) => ({ ...current, [projectId]: videos })))
        .catch(() => setVideosByProject((current) => ({ ...current, [projectId]: [] })));
    }
  }, [jobs, videosByProject]);

  /**
   * Fortschritt der Verarbeitung nachfragen. Zwei Quellen, je nachdem, wie
   * weit die Zeile ist: Wer schon gespeichert hat, fragt an der Fassung nach –
   * wer noch nicht, an der Upload-Sitzung, denn seit Phase 18 läuft die
   * Verarbeitung dort schon im Zwischenspeicher.
   */
  const refreshTranscode = useCallback(async () => {
    for (const job of jobsRef.current) {
      if (job.state === 'bereit' && job.uploadId && !job.versionId) {
        try {
          const sitzung = await api.getUpload(job.uploadId);
          update(job.id, {
            transcodeProgress:
              sitzung.transcodeStatus === 'READY' ? 100 : sitzung.transcodeProgress,
            ...(sitzung.transcodeStatus === 'FAILED'
              ? { message: sitzung.transcodeError ?? t('upload.processingFailed') }
              : {}),
          });
        } catch {
          // Wie unten: Ein Aussetzer beim Nachfragen ändert nichts am Upload.
        }
        continue;
      }
      /*
       * Verarbeitet, aber ohne Fassung: Dann hängt der Stand noch an der
       * Sitzung. Ohne diesen Zweig lief die Leiste in eine Sackgasse – der
       * Takt unten sah „verarbeitet" und fragte weiter, hier fiel die Zeile
       * durch, und der Balken stand bis zum Neuladen der Seite.
       */
      if (job.state === 'verarbeitet' && !job.versionId && job.uploadId) {
        try {
          const sitzung = await api.getUpload(job.uploadId);
          if (sitzung.versionId) {
            update(job.id, { versionId: sitzung.versionId });
          } else if (sitzung.transcodeStatus === 'READY') {
            update(job.id, { state: 'fertig', transcodeProgress: 100 });
          } else {
            update(job.id, { transcodeProgress: sitzung.transcodeProgress });
          }
        } catch {
          // Ein Aussetzer beim Nachfragen ändert nichts am Upload.
        }
        continue;
      }
      if (job.state !== 'verarbeitet' || !job.versionId) continue;
      try {
        const version = await api.getVersion(job.versionId);
        if (version.status === 'READY') {
          update(job.id, { state: 'fertig', transcodeProgress: 100 });
        } else if (version.status === 'FAILED') {
          update(job.id, {
            state: 'fehler',
            message: version.processingError ?? t('upload.processingFailed'),
          });
        } else {
          update(job.id, { transcodeProgress: version.progress });
        }
      } catch {
        // Ein vorübergehender Fehler beim Nachfragen ist kein Grund,
        // den Upload als gescheitert zu markieren.
      }
    }
  }, [update, t]);

  /**
   * Der Takt der Nachfrage (1.6.1 geradegerückt).
   *
   * Er hing an `jobs` – und `jobs` ändert sich während einer Übertragung alle
   * 150 Millisekunden, weil der Fortschritt hineingeschrieben wird. Jede
   * Änderung räumte das Intervall ab und setzte es neu, also **feuerte es
   * nie**, solange irgendetwas hochlud. Beim Stapel-Upload heißt das: Die
   * Verarbeitung des ersten Films läuft, seine Leiste steht, und sie steht
   * auch dann noch, wenn das Video längst fertig ist und abspielt.
   *
   * Jetzt hängt der Takt nur noch an einem Ja/Nein, und die Jobs kommen über
   * eine Box herein statt über die Abhängigkeitsliste.
   *
   * Eine Sekunde statt zweieinhalb: Der Worker läuft auf dem Mac-Server nativ
   * und meldet fein auflösenden Fortschritt; bei 2,5 Sekunden sah der Balken
   * aus, als ruckle er.
   */
  const laeuftVerarbeitung = jobs.some(
    (job) =>
      job.state === 'verarbeitet' ||
      (job.state === 'bereit' && job.uploadId && job.transcodeProgress < 100),
  );

  useEffect(() => {
    if (!laeuftVerarbeitung) return;
    // Gegen Überholen: Antwortet der Server einmal langsamer als der Takt,
    // sollen sich die Nachfragen nicht stapeln.
    let laeuftGerade = false;
    const nachfragen = async () => {
      if (laeuftGerade) return;
      laeuftGerade = true;
      try {
        await refreshTranscode();
      } finally {
        laeuftGerade = false;
      }
    };
    void nachfragen();
    const timer = setInterval(() => void nachfragen(), 1000);
    return () => clearInterval(timer);
  }, [laeuftVerarbeitung, refreshTranscode]);

  const summary = useMemo(() => {
    const bereit = jobs.filter((job) => job.state === 'bereit').length;
    if (active.length > 0) return t('upload.summaryRunning', { count: active.length });
    if (bereit > 0) return t('upload.summaryUnsaved', { count: bereit });
    if (pending.length > 0) return t('upload.summaryWaiting', { count: pending.length });
    const failed = jobs.filter((job) => job.state === 'fehler').length;
    if (failed > 0) return t('upload.summaryFailed', { count: failed });
    return t('upload.summaryDone', { count: jobs.length });
  }, [active.length, pending.length, jobs]);

  if (jobs.length === 0) return null;

  return (
    <div className="uploadpanel" data-open={open}>
      <button type="button" className="uploadpanel__bar" onClick={() => setOpen(!open)}>
        <span className="uploadpanel__title">{t('upload.title')}</span>
        <span className="badge">{summary}</span>
        <span className="shell__spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {open ? t('upload.minimize') : t('upload.open')}
        </span>
        <span aria-hidden>{open ? '▾' : '▴'}</span>
      </button>

      {open ? (
        <div className="uploadpanel__body">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              projects={projects}
              videos={videosByProject[job.projectId] ?? []}
              internVerfuegbar={fassungen?.internalEnabled ?? true}
              // Bis zur Aufnahme ins Projekt bleibt alles änderbar – genau
              // dafür läuft die Übertragung ja schon im Hintergrund.
              editable={
                (job.state === 'wartet' || job.state === 'lädt' || job.state === 'bereit') && isTeam
              }
              onChange={(changes) => update(job.id, changes)}
              onSave={() => save(job.id)}
              onUnsave={() => unsave(job.id)}
              onCancel={() => cancel(job.id)}
              onRemove={() => remove(job.id)}
            />
          ))}

          <div className="uploadpanel__actions">
            <button type="button" className="button button--ghost" onClick={clearFinished}>
              {t('upload.hideFinished')}
            </button>
            <div className="shell__spacer" />
            {/* Alles mit Projekt läuft von selbst los. Der Knopf bleibt für
                die Dateien, denen noch ein Ziel fehlt. */}
            {pending.length > 0 ? (
              <button
                type="button"
                className="button button--primary"
                onClick={start}
                disabled={pending.every((job) => !job.projectId)}
                title={
                  pending.some((job) => !job.projectId)
                    ? t('upload.startHint')
                    : undefined
                }
              >
                {pending.length === 1 ? t('upload.start') : t('upload.startMany', { count: pending.length })}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JobRow({
  job,
  projects,
  videos,
  internVerfuegbar,
  editable,
  onChange,
  onSave,
  onUnsave,
  onCancel,
  onRemove,
}: {
  job: UploadJob;
  projects: ProjectDto[];
  videos: VideoDto[];
  /** Fährt dieses Haus überhaupt eine interne Runde? (Phase 28) */
  internVerfuegbar: boolean;
  editable: boolean;
  onChange: (changes: Partial<UploadJob>) => void;
  onSave: () => void;
  onUnsave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { formatBytes } = useFormat();
  const uploadFraction = job.sizeBytes > 0 ? job.uploadedBytes / job.sizeBytes : 0;
  const isVideo = job.target === 'video';

  // Ohne Eingabe zählt die API weiter; wer will, trägt eine eigene Nummer ein –
  // auch eine Zwischenfassung wie 2.5. Ob sie zulässig ist, entscheidet die API
  // beim Anlegen der Sitzung, also *vor* der Übertragung.
  const selectedVideo = videos.find((video) => video.id === job.videoId) ?? null;
  const nextVersion = selectedVideo ? selectedVideo.versionCount + 1 : 1;
  const gewaehlt = job.versionNumber.trim() ? Number(job.versionNumber.replace(',', '.')) : null;
  const versionMismatch =
    gewaehlt === null && job.detectedVersion !== null && job.detectedVersion !== nextVersion;

  return (
    <div className="uploadjob" data-state={job.state}>
      <div className="toolbar">
        <span className="uploadjob__name" title={job.filename}>
          {job.filename}
        </span>
        <span className="shell__spacer" />
        <span className="muted mono" style={{ fontSize: 12 }}>
          {formatBytes(job.uploadedBytes)} / {formatBytes(job.sizeBytes)}
        </span>
        <StateBadge job={job} />
        {/*
          Speichern geht seit Phase 18 schon während der Übertragung – und seit
          1.6.1 auch davor, an jeder wartenden Zeile. Beim Stapel-Upload war der
          Knopf vorher nur an der einen Zeile zu sehen, die gerade übertrug: Wer
          für alle acht Filme die Angaben beisammen hatte, musste daneben sitzen
          und jede Datei einzeln abpassen. Vorgemerktes geht von selbst raus,
          sobald die Sitzung dieser Datei steht.
        */}
        {(job.state === 'wartet' || job.state === 'bereit' || job.state === 'lädt') &&
        !job.gespeichert ? (
          <button
            type="button"
            className={job.sollSpeichern ? 'button button--ghost' : 'button button--primary'}
            onClick={job.sollSpeichern ? onUnsave : onSave}
            disabled={!job.projectId || (!job.videoId && !job.newVideoName.trim())}
            title={
              !job.projectId
                ? t('upload.needProject')
                : !job.videoId && !job.newVideoName.trim()
                  ? t('upload.needVideo')
                  : job.sollSpeichern
                    ? t('upload.queuedForSaveHint')
                    : job.uploadId
                      ? t('upload.willBeAdded')
                      : t('upload.saveLaterHint')
            }
          >
            {job.sollSpeichern ? t('upload.queuedForSave') : t('common.save')}
          </button>
        ) : null}
        {job.state === 'lädt' ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
        {job.state === 'bereit' ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            {t('upload.discard')}
          </button>
        ) : null}
        {job.state === 'wartet' || job.state === 'fehler' || job.state === 'abgebrochen' ? (
          <button type="button" className="button button--ghost" onClick={onRemove}>
            {t('common.remove')}
          </button>
        ) : null}
      </div>

      {editable && isVideo ? (
        <div className="uploadjob__fields">
          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">{t('upload.project')}</span>
            <select
              className="select"
              value={job.projectId}
              onChange={(event) => onChange({ projectId: event.target.value, videoId: '' })}
            >
              <option value="">{t('upload.pickPlease')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.customer ? `${project.customer} · ` : ''}
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">{t('upload.video')}</span>
            <select
              className="select"
              value={job.videoId}
              onChange={(event) => onChange({ videoId: event.target.value })}
            >
              <option value="">{t('upload.newVideo')}</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {t('upload.nextVersionHint', {
                    name: video.name,
                    version: video.versionCount + 1,
                  })}
                </option>
              ))}
            </select>
          </label>

          {job.videoId ? null : (
            <label className="field" style={{ margin: 0 }}>
              <span className="field__label">{t('upload.newVideoName')}</span>
              <input
                className="input"
                value={job.newVideoName}
                // `nameBeruehrt`: Ab jetzt gehört der Name dem Menschen – der
                // automatische Vorschlag fasst ihn nicht mehr an (Phase 25).
                onChange={(event) =>
                  onChange({ newVideoName: event.target.value, nameBeruehrt: true })
                }
              />
            </label>
          )}

          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">{t('upload.version')}</span>
            <input
              className="input"
              type="number"
              min="0.001"
              step="0.5"
              inputMode="decimal"
              placeholder={`automatisch (v${nextVersion})`}
              value={job.versionNumber}
              onChange={(event) => onChange({ versionNumber: event.target.value })}
              data-version={nextVersion}
            />
            {gewaehlt !== null && Number.isFinite(gewaehlt) ? (
              <p className="hint">{t('upload.versionWillBe', { label: versionLabel(gewaehlt) })}</p>
            ) : versionMismatch ? (
              <p className="hint">
                {t('upload.versionMismatch', {
                  detected: job.detectedVersion ?? '',
                  next: nextVersion,
                })}
              </p>
            ) : null}
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">{t('upload.fileDate')}</span>
            <input
              className="input"
              type="date"
              value={job.fileDate}
              onChange={(event) => onChange({ fileDate: event.target.value })}
            />
          </label>

          {/* Interne Fassung (Phase 27): Der Haken steht an jeder Zeile
              einzeln – im Multi-Upload kommen oft mehrere Filme zugleich, und
              nicht jeder soll durch die interne Runde. Ist die Funktion im
              Workspace abgeschaltet, fehlt er ganz (Phase 28). */}
          {internVerfuegbar ? (
          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">{t('upload.internal')}</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={job.internal}
                onChange={(event) =>
                  onChange({ internal: event.target.checked, internBeruehrt: true })
                }
              />
              {t('upload.internalLabel')}
            </label>
            <p className="hint">{t('upload.internalHint')}</p>
          </label>
          ) : null}
        </div>
      ) : null}

      {job.state === 'bereit' ? (
        <div className="uploadjob__hint">
          {t('upload.readyHint')}
        </div>
      ) : null}

      {editable && job.hint ? <div className="uploadjob__hint">⚠ {job.hint}</div> : null}

      {job.state === 'lädt' ||
      job.state === 'bereit' ||
      job.state === 'fertig' ||
      job.state === 'verarbeitet' ? (
        <>
          <div className="progress" style={{ marginTop: 6 }}>
            <div className="progress__bar" style={{ width: `${uploadFraction * 100}%` }} />
          </div>
          {isVideo && job.state !== 'lädt' && job.state !== 'bereit' ? (
            <div className="uploadjob__transcode">
              <span className="faint" style={{ fontSize: 12 }}>
                {t('upload.processing')}
              </span>
              <div className="progress" style={{ flex: 1 }}>
                <div
                  className="progress__bar"
                  style={{
                    width: `${job.state === 'fertig' ? 100 : job.transcodeProgress}%`,
                    background: 'var(--klappe-success)',
                  }}
                />
              </div>
              <span className="faint mono" style={{ fontSize: 12 }}>
                {job.state === 'fertig' ? 100 : job.transcodeProgress} %
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {job.message ? <div className="uploadjob__hint">{job.message}</div> : null}
    </div>
  );
}

function StateBadge({ job }: { job: UploadJob }) {
  const t = useT();
  switch (job.state) {
    case 'fertig':
      return <span className="badge badge--ready">{t('upload.stateDone')}</span>;
    case 'fehler':
      return <span className="badge badge--failed">{t('upload.stateError')}</span>;
    case 'verarbeitet':
      return <span className="badge badge--processing">{t('upload.processing')}</span>;
    case 'lädt':
      // Wer schon gespeichert hat, wartet nur noch auf die letzten Bytes –
      // danach läuft alles von selbst weiter (Phase 18).
      return job.gespeichert ? (
        <span className="badge badge--ready">{t('upload.stateSavedUploading')}</span>
      ) : (
        <span className="badge">{t('upload.stateUploading')}</span>
      );
    case 'bereit':
      // Die Bytes sind da und die Verarbeitung läuft schon (Phase 18) – nur
      // aufgenommen wird erst auf Knopfdruck.
      return job.transcodeProgress > 0 && job.transcodeProgress < 100 ? (
        <span className="badge badge--processing">
          {t('upload.stateUnsavedProcessing', { percent: job.transcodeProgress })}
        </span>
      ) : (
        <span className="badge badge--processing">{t('upload.stateUnsaved')}</span>
      );
    case 'abgebrochen':
      return <span className="badge">{t('upload.stateAborted')}</span>;
    default:
      // Vorgemerkt (1.6.1): Die Zeile wartet noch auf ihre Übertragung, ihre
      // Angaben stehen aber schon fest und gehen von selbst raus. Ohne diesen
      // Hinweis sähe eine vorgemerkte Zeile aus wie jede andere wartende.
      return job.sollSpeichern ? (
        <span className="badge badge--ready">{t('upload.stateQueuedForSave')}</span>
      ) : (
        <span className="badge">{t('upload.stateWaiting')}</span>
      );
  }
}
