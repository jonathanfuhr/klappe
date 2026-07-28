'use client';

import type { CommentDto, UserDto } from '@klappe/shared';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatRelative, initialsOf } from '@/lib/format';
import { CommentBody } from './CommentBody';
import { CommentComposer } from './CommentComposer';

interface CommentPanelProps {
  comments: CommentDto[];
  currentUser: UserDto | null;
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
}

type Filter = 'alle' | 'offen' | 'erledigt';

export function CommentPanel({
  comments,
  currentUser,
  activeCommentId,
  composerFrame,
  composerTimecode,
  pinned,
  onPinnedChange,
  focusToken,
  onSelect,
  onChanged,
  onCreate,
}: CommentPanelProps) {
  const [filter, setFilter] = useState<Filter>('alle');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const visible = useMemo(() => {
    if (filter === 'offen') return comments.filter((comment) => !comment.resolvedAt);
    if (filter === 'erledigt') return comments.filter((comment) => comment.resolvedAt);
    return comments;
  }, [comments, filter]);

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
              <span className="comment__author">{comment.author.name}</span>
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

            {comment.editedAt ? <span className="faint" style={{ fontSize: 11 }}>bearbeitet</span> : null}

            <div className="comment__actions">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setReplyTo(replyTo === comment.id ? null : comment.id);
                }}
              >
                Antworten
              </button>
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
              {canModify(comment, currentUser) ? (
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
                      <span className="comment__author">{reply.author.name}</span>
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
                    {canModify(reply, currentUser) ? (
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

      <CommentComposer
        frame={composerFrame}
        timecode={composerTimecode}
        pinned={pinned}
        onPinnedChange={onPinnedChange}
        focusToken={focusToken}
        onSubmit={(body) => onCreate(body, { frame: pinned ? composerFrame : null })}
      />
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

function canModify(comment: CommentDto, user: UserDto | null): boolean {
  if (!user) return false;
  return comment.author.id === user.id || user.role === 'ADMIN';
}
