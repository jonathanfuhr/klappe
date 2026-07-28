'use client';

import { tokenizeCommentBody } from '@klappe/shared';
import { Fragment, useMemo } from 'react';

/**
 * Stellt den Kommentartext dar und hebt @-Mentions hervor. Zerlegt wird mit
 * demselben Parser, den der Server für die Benachrichtigungen benutzt – so
 * kann Angezeigtes und Benachrichtigtes nicht auseinanderlaufen.
 */
export function CommentBody({ body }: { body: string }) {
  const tokens = useMemo(() => tokenizeCommentBody(body), [body]);

  return (
    <div className="comment__body">
      {tokens.map((token, index) =>
        token.type === 'mention' ? (
          <span key={`${token.userId}-${index}`} className="mention">
            @{token.label}
          </span>
        ) : (
          <Fragment key={`text-${index}`}>{token.value}</Fragment>
        ),
      )}
    </div>
  );
}
