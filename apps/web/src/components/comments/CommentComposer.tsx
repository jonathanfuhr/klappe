'use client';

import { type UserSummaryDto, serializeMention } from '@klappe/shared';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { initialsOf } from '@/lib/format';

interface CommentComposerProps {
  /** Frame, an den der Kommentar geheftet wird; `null` = ohne Zeitbezug. */
  frame: number | null;
  timecode: string | null;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onSubmit: (body: string) => Promise<void>;
  placeholder?: string;
  submitLabel?: string;
  autoFocus?: boolean;
  /** Bei jeder Änderung springt der Cursor ins Feld (Shortcut „C“). */
  focusToken?: number;
  /** Es liegt eine Zeichnung bereit, die mitgeschickt wird. */
  hasAnnotation?: boolean;
  onClearAnnotation?: () => void;
  onCancel?: () => void;
}

/**
 * Eingabefeld für Kommentare samt @-Mention-Vorschlägen.
 *
 * Ausgewählte Personen werden als `@[Name](id)` in den Text geschrieben. Der
 * Nutzer sieht dabei weiterhin nur seinen Text – gespeichert wird die
 * eindeutige Zuordnung.
 */
export function CommentComposer({
  frame,
  timecode,
  pinned,
  onPinnedChange,
  onSubmit,
  placeholder = 'Kommentar schreiben … @ erwähnt jemanden',
  submitLabel = 'Kommentieren',
  autoFocus,
  focusToken,
  hasAnnotation,
  onClearAnnotation,
  onCancel,
}: CommentComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState<{ term: string; start: number } | null>(null);
  const [suggestions, setSuggestions] = useState<UserSummaryDto[]>([]);
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (focusToken !== undefined && focusToken > 0) textareaRef.current?.focus();
  }, [focusToken]);

  useEffect(() => {
    if (!query) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    // Kurze Verzögerung: Sonst läuft bei jedem Tastendruck eine Anfrage.
    const timer = setTimeout(() => {
      api
        .mentionableUsers(query.term)
        .then((users) => {
          if (!cancelled) {
            setSuggestions(users);
            setHighlighted(0);
          }
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  /** Sucht das `@wort`, in dem der Cursor gerade steht. */
  const updateQuery = useCallback((text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = before.match(/(?:^|\s)@([\p{L}\p{N}._-]{0,40})$/u);
    if (!match) {
      setQuery(null);
      return;
    }
    setQuery({ term: match[1], start: caret - match[1].length - 1 });
  }, []);

  const insertMention = useCallback(
    (user: UserSummaryDto) => {
      const textarea = textareaRef.current;
      if (!textarea || !query) return;

      const caret = textarea.selectionStart;
      const token = `${serializeMention(user)} `;
      const next = value.slice(0, query.start) + token + value.slice(caret);
      setValue(next);
      setQuery(null);
      setSuggestions([]);

      requestAnimationFrame(() => {
        const position = query.start + token.length;
        textarea.focus();
        textarea.setSelectionRange(position, position);
      });
    },
    [query, value],
  );

  const submit = useCallback(async () => {
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body);
      setValue('');
      setQuery(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }, [value, busy, onSubmit]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlighted((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlighted((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const user = suggestions[highlighted];
        if (user) insertMention(user);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setQuery(null);
        setSuggestions([]);
        return;
      }
    }

    // Enter sendet, Umschalt+Enter macht einen Absatz.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="composer">
      {suggestions.length > 0 ? (
        <div className="suggestions" role="listbox">
          {suggestions.map((user, index) => (
            <button
              key={user.id}
              type="button"
              className="suggestions__item"
              data-active={index === highlighted}
              onMouseDown={(event) => {
                // Klick darf den Fokus nicht aus dem Textfeld nehmen.
                event.preventDefault();
                insertMention(user);
              }}
            >
              <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>
                {initialsOf(user.name)}
              </span>
              <span>{user.name}</span>
              <span className="faint" style={{ marginLeft: 'auto', fontSize: 12 }}>
                {user.email}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className="textarea"
        value={value}
        placeholder={placeholder}
        rows={3}
        onChange={(event) => {
          setValue(event.target.value);
          updateQuery(event.target.value, event.target.selectionStart);
        }}
        onKeyUp={(event) => updateQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onClick={(event) => updateQuery(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
      />

      {error ? (
        <div className="notice" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}

      {hasAnnotation ? (
        <div className="composer__row">
          <span className="comment__pen">✎ Zeichnung wird mitgeschickt</span>
          {onClearAnnotation ? (
            <button type="button" className="button button--ghost" onClick={onClearAnnotation}>
              Verwerfen
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="composer__row">
        <label className="composer__pin">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(event) => onPinnedChange(event.target.checked)}
          />
          {pinned && timecode ? (
            <>
              An <span className="mono">{timecode}</span> heften
              {frame !== null ? <span className="faint"> (Frame {frame})</span> : null}
            </>
          ) : (
            'Ohne Zeitbezug'
          )}
        </label>

        <div className="shell__spacer" />

        {onCancel ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Abbrechen
          </button>
        ) : null}
        <button
          type="button"
          className="button button--primary"
          onClick={() => void submit()}
          disabled={busy || value.trim().length === 0}
        >
          {busy ? 'Wird gespeichert …' : submitLabel}
        </button>
      </div>
    </div>
  );
}
