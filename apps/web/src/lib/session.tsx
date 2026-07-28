'use client';

import type { UserDto } from '@klappe/shared';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, api } from './api';

interface SessionState {
  user: UserDto | null;
  loading: boolean;
  /** Liefert das geladene Konto zurück – oder null, wenn keine Sitzung steht. */
  refresh: () => Promise<UserDto | null>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  // Auf diesen Seiten gibt es noch keine Sitzung – die Abfrage würde nur eine
  // 401 in der Browser-Konsole erzeugen.
  const onLoginPage =
    pathname === '/login' || pathname === '/abmelden' || pathname.startsWith('/f/');

  const refresh = useCallback(async () => {
    try {
      const geladen = await api.me();
      setUser(geladen);
      return geladen;
    } catch (error) {
      setUser(null);
      // Abgelaufene Sitzung: zurück zum Login, statt leere Seiten zu zeigen.
      if (error instanceof ApiError && error.isUnauthorized) {
        router.replace('/login');
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (onLoginPage) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [refresh, onLoginPage]);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    router.replace('/login');
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession muss innerhalb von <SessionProvider> benutzt werden.');
  }
  return context;
}
