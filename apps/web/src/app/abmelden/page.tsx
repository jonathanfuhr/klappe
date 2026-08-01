'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Ziel des Abmelde-Links aus jeder Benachrichtigungs-Mail (Phase 8). */
function Unsubscribe() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'läuft' | 'fertig' | 'fehler'>('läuft');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('fehler');
      setMessage(t('unsubscribe.linkIncomplete'));
      return;
    }
    api
      .unsubscribe(token)
      .then(() => setState('fertig'))
      .catch((error: unknown) => {
        setState('fehler');
        setMessage(error instanceof Error ? error.message : t('unsubscribe.failed'));
      });
  }, [token, t]);

  return (
    <div className="card gate__card">
      <BrandMark />

      {state === 'läuft' ? <p className="muted">{t('unsubscribe.oneMoment')}</p> : null}

      {state === 'fertig' ? (
        <>
          <h1 style={{ fontSize: 18, margin: '10px 0' }}>{t('unsubscribe.done')}</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            {t('unsubscribe.doneBody')}
          </p>
        </>
      ) : null}

      {state === 'fehler' ? <div className="notice">{message}</div> : null}
    </div>
  );
}

export default function UnsubscribePage() {
  const t = useT();
  return (
    <div className="gate">
      <Suspense fallback={<div className="card gate__card">{t('common.loading')}</div>}>
        <Unsubscribe />
      </Suspense>
    </div>
  );
}
