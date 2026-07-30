'use client';

import type { Annotation, CommentDto, UserDto } from '@klappe/shared';
import { useMemo, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { api } from '@/lib/api';
import { formatRelative, initialsOf } from '@/lib/format';
import { CommentBody } from './CommentBody';
import { CommentComposer } from './CommentComposer';

interface CommentPanelProps {
  comments: CommentDto[];
  currentUser: UserDto | null;
  /**
   * Team oder externer Projektadmin (Phase 21) – darf auch fremde Kommentare
   * bearbeiten und löschen, nicht nur die eigenen.
   */
  canManageComments?: boolean;
  activeCommentId: string | null;
  composerFrame: number | null;
  composerTimecode: string | null;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  /** Zähler aus der Review-Seite: erhöht sich, wenn „C“ gedrückt wurde. */
  focusToken?: number;
  onSelect: (comment: CommentDto) => void;
  onChanged: () => Promise<void> | void;
  onCreate: (body: string, options: { frame: number | null; parentId?: string }) => Promise<void>;
  /** Gerade auf dem Bild gezeichnete Skizze, die mitgeschickt wird. */
  draftAnnotation?: Annotation | null;
  onClearDraftAnnotation?: () => void;
  /** Gäste ohne Kommentarrecht sehen nur mit. */
  canComment?: boolean;
}

type Filter = 'alle' | 'offen' | 'erledigt';
/** Standard ist der Timecode – so liest man ein Video, nicht nach Uhrzeit. */
type Sortierung = 'timecode' | 'erstellt';

export function CommentPanel({
  comments,
  currentUser,
  canManageComments = false,
  activeCommentId,
  composerFrame,
  composerTimecode,
  pinned,
  onPinnedChange,
  focusToken,
  onSelect,
  onChanged,
  onCreate,
  draftAnnotation,
  onClearDraftAnnotation,
  canComment = true,
}: CommentPanelProps) {
  const [filter, setFilter] = useState<Filter>('alle');
  const zeigeName = useUserName();
  const [sortierung, setSortierung] = useState<Sortierung>('timecode');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const visible = useMemo(() => {
    const gefiltert =
      filter === 'offen'
        ? comments.filter((comment) => !comment.resolvedAt)
        : filter === 'erledigt'
          ? comments.filter((comment) => comment.resolvedAt)
          : comments;

    // Nur die obersten Kommentare werden umsortiert (Phase 17). Antworten
    // bleiben in ihrem Faden chronologisch – ein Gespräch nach Timecode zu
    // ordnen ergäbe keinen Sinn.
    if (sortierung === 'erstellt') {
      return [...gefiltert].sort((links, rechts) =>
        links.createdAt.localeCompare(rechts.createdAt),
      );
    }
    return [...gefiltert].sort((links, rechts) => {
      // Dieselbe Ordnung wie in der API (`comments.service.ts`): nach Frame,
      // und allgemeine Anmerkungen ohne Zeitbezug hängen sich hinten an.
      if (links.frame === null && rechts.frame === null) {
        return links.createdAt.localeCompare(rechts.createdAt);
      }
      if (links.frame === null) return 1;
      if (rechts.frame === null) return -1;
      if (links.frame !== rechts.frame) return links.frame - rechts.frame;
      return links.createdAt.localeCompare(rechts.createdAt);
    });
  }, [comments, filter, sortierung]);

  const openCount = comments.filter((comment) => !comment.resolvedAt).length;

  return (
    <div className="comments">
      <div className="comments__header">
        <span className="comments__title">Kommentare</span>
        <span className="badge">{openCount} offen</span>
        <div className="shell__spacer" />
        <select
          className="select"
          style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
          aria-label="Filter"
        >
          <option value="alle">Alle</option>
          <option value="offen">Offen</option>
          <option value="erledigt">Erledigt</option>
        </select>
        <select
          className="select"
          style={{ width: 'auto', padding: '4px 8px', fontSize: 13 }}
          value={sortierung}
          onChange={(event) => setSortierung(event.target.value as Sortierung)}
          aria-label="Sortierung"
        >
          <option value="timecode">nach Timecode</option>
          <option value="erstellt">nach Zeitpunkt</option>
        </select>
      </div>

      <div className="comments__list">
        {visible.length === 0 ? (
          <p className="muted" style={{ padding: '18px 4px', fontSize: 14 }}>
            Noch keine Kommentare. Mit <span className="shortcuts__key">C</span> setzt du einen am
            aktuellen Bild.
          </p>
        ) : null}

        {visible.map((comment) => (
          <div
            key={comment.id}
            className="comment"
            data-active={comment.id === activeCommentId}
            data-resolved={Boolean(comment.resolvedAt)}
            onClick={() => onSelect(comment)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelect(comment);
            }}
          >
            <div className="comment__head">
              <span className="avatar" style={{ width: 24, height: 24, fontSize: 11 }}>
                {initialsOf(comment.author.name)}
              </span>
              <span className="comment__author">{zeigeName(comment.author)}</span>
              {comment.timecode ? (
                <button
                  type="button"
                  className="comment__tc mono"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(comment);
                  }}
                  title="Zu dieser Stelle springen"
                >
                  {comment.timecode}
                </button>
              ) : (
                <span className="badge">allgemein</span>
              )}
              <span className="shell__spacer" />
              <span className="comment__time">{formatRelative(comment.createdAt)}</span>
            </div>

            {editing === comment.id ? (
              <EditForm
                comment={comment}
                onDone={async () => {
                  setEditing(null);
                  await onChanged();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <CommentBody body={comment.body} />
            )}

            <div className="toolbar" style={{ gap: 10 }}>
              {comment.annotation ? (
                <span className="comment__pen" title="Enthält eine Zeichnung auf dem Bild">
                  ✎ Zeichnung
                </span>
              ) : null}
              {comment.editedAt ? (
                <span className="faint" style={{ fontSize: 11 }}>
                  bearbeitet
                </span>
              ) : null}
            </div>

            <div className="comment__actions">
              {canComment ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setReplyTo(replyTo === comment.id ? null : comment.id);
                  }}
                >
                  Antworten
                </button>
              ) : null}
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void api
                    .setCommentResolved(comment.id, !comment.resolvedAt)
                    .then(() => onChanged());
                }}
              >
                {comment.resolvedAt ? 'Wieder öffnen' : 'Erledigt'}
              </button>
              {canModify(comment, currentUser, canManageComments) ? (
                <>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditing(comment.id);
                    }}
                  >
                    Bearbeiten
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!window.confirm('Diesen Kommentar löschen?')) return;
                      void api.deleteComment(comment.id).then(() => onChanged());
                    }}
                  >
                    Löschen
                  </button>
                </>
              ) : null}
            </div>

            {comment.replies.length > 0 ? (
              <div className="comment__replies">
                {comment.replies.map((reply) => (
                  <div key={reply.id} className="comment" style={{ padding: '6px 8px' }}>
                    <div className="comment__head">
                      <span className="avatar" style={{ width: 20, height: 20, fontSize: 10 }}>
                        {initialsOf(reply.author.name)}
                      </span>
                      <span className="comment__author">{zeigeName(reply.author)}</span>
                      <span className="shell__spacer" />
                      <span className="comment__time">{formatRelative(reply.createdAt)}</span>
                    </div>
                    {editing === reply.id ? (
                      <EditForm
                        comment={reply}
                        onDone={async () => {
                          setEditing(null);
                          await onChanged();
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <CommentBody body={reply.body} />
                    )}
                    {canModify(reply, currentUser, canManageComments) ? (
                      <div className="comment__actions">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditing(reply.id);
                          }}
                        >
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!window.confirm('Diese Antwort löschen?')) return;
                            void api.deleteComment(reply.id).then(() => onChanged());
                          }}
                        >
                          Löschen
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {replyTo === comment.id ? (
              <div onClick={(event) => event.stopPropagation()}>
                <CommentComposer
                  frame={null}
                  timecode={null}
                  pinned={false}
                  onPinnedChange={() => undefined}
                  placeholder="Antwort schreiben …"
                  submitLabel="Antworten"
                  autoFocus
                  onCancel={() => setReplyTo(null)}
                  onSubmit={async (body) => {
                    await onCreate(body, { frame: null, parentId: comment.id });
                    setReplyTo(null);
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {canComment ? (
        <CommentComposer
          frame={composerFrame}
          timecode={composerTimecode}
          pinned={pinned}
          onPinnedChange={onPinnedChange}
          focusToken={focusToken}
          hasAnnotation={Boolean(draftAnnotation)}
          onClearAnnotation={onClearDraftAnnotation}
          // Eine Zeichnung hängt an einem Frame – ohne Zeitbezug ginge sie
          // beim Absenden verloren (Phase 21 Bugfix), unabhängig davon, ob
          // der Haken „Ohne Zeitbezug" gerade gesetzt ist.
          onSubmit={(body) =>
            onCreate(body, { frame: pinned || draftAnnotation ? composerFrame : null })
          }
        />
      ) : (
        <div className="composer">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Für diese Freigabe ist das Kommentieren nicht erlaubt.
          </p>
        </div>
      )}
    </div>
  );
}

function EditForm({
  comment,
  onDone,
  onCancel,
}: {
  comment: CommentDto;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(comment.body);
  const [busy, setBusy] = useState(false);

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <textarea
        className="textarea"
        value={value}
        rows={3}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="composer__row">
        <div className="shell__spacer" />
        <button type="button" className="button button--ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !value.trim()}
          onClick={() => {
            setBusy(true);
            void api
              .updateComment(comment.id, value.trim())
              .then(() => onDone())
              .finally(() => setBusy(false));
          }}
        >
          Speichern
        </button>
      </div>
    </div>
  );
}

function canModify(comment: CommentDto, user: UserDto | null, canManageComments: boolean): boolean {
  if (!user) return false;
  if (canManageComments) return true;
  return comment.author.id === user.id || user.role === 'ADMIN';
}
