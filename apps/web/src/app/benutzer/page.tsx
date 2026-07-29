'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Seit Phase 17 stehen Benutzer und Gäste in den Einstellungen. Die alte
 * Adresse bleibt als Weiterleitung – Lesezeichen und Links aus alten E-Mails
 * sollen nicht ins Leere zeigen.
 */
export default function UsersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/einstellungen');
  }, [router]);
  return null;
}
