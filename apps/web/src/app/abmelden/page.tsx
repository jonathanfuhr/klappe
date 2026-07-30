'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { api } from '@/lib/api';

/** Ziel des Abmelde-Links aus jeder Benachrichtigungs-Mail (Phase 8). */
function Unsubscribe() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'läuft' | 'fertig' | 'fehler'>('läuft');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setState('fehler');
      setMessage('Der Link ist unvollständig.');
      return;
    }
    api
      .unsubscribe(token)
      .then(() => setState('fertig'))
      .catch((error: unknown) => {
        setState('fehler');
        setMessage(error instanceof Error ? error.message : 'Das hat nicht geklappt.');
      });
  }, [token]);

  return (
    <div className="card gate__card">
      <BrandMark />

      {state === 'läuft' ? <p className="muted">Einen Moment …</p> : null}

      {state === 'fertig' ? (
        <>
          <h1 style={{ fontSize: 18, margin: '10px 0' }}>Benachrichtigungen abbestellt</h1>
          <p className="muted" style={{ fontSize: 14 }}>
            Du bekommst keine E-Mails mehr zu Kommentaren, Erwähnungen und Uploads. In deinem Profil
            lässt sich das jederzeit wieder einschalten.
          </p>
        </>
      ) : null}

      {state === 'fehler' ? <div className="notice">{message}</div> : null}
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <div className="gate">
      <Suspense fallback={<div className="card gate__card">Wird geladen …</div>}>
        <Unsubscribe />
      </Suspense>
    </div>
  );
}
