'use client';

import { displayUserName } from '@klappe/shared';
import { useCallback } from 'react';
import { useBranding } from './branding';

/**
 * Namen so anzeigen, wie sie überall stehen sollen (Phase 20): mit dem
 * Firmenkürzel in Klammern, wenn die Person zum eigenen Team gehört.
 *
 * Als Hook und nicht als Komponente, weil der Name an einigen Stellen als
 * reine Zeichenkette gebraucht wird – in einem `title`, in der Sprungliste
 * der Zeitleiste, in einer Suche.
 */
export function useUserName(): (
  user: { name: string; role?: string | null } | null | undefined,
) => string {
  const { branding } = useBranding();
  return useCallback(
    (user) => (user ? displayUserName(user.name, user.role, branding.companyShort) : ''),
    [branding.companyShort],
  );
}
