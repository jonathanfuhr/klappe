'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { API_BASE } from './api';

export interface LiveEvent {
  topic: 'video' | 'project' | 'notification';
  id: string;
  projectId?: string;
  userId?: string;
}

interface LiveState {
  /** Steht die Leitung? Solange nicht, lädt die Oberfläche wie früher nach. */
  connected: boolean;
  /** Meldet sich bei jedem Ereignis; gibt die Abmeldung zurück. */
  subscribe: (handler: (event: LiveEvent) => void) => () => void;
}

const LiveContext = createContext<LiveState | null>(null);

/**
 * Live-Aktualisierung statt regelmäßigem Nachladen (Phase 18, Zusatz).
 *
 * Eine Verbindung für die ganze Anwendung, über `EventSource`. Was ankommt,
 * ist bewusst inhaltslos – nur „an dieser Stelle hat sich etwas getan“; die
 * Seiten holen sich die Daten danach über die gewohnten Wege, mit der
 * gewohnten Rechteprüfung.
 *
 * `connected` ist der wichtige Teil: Steht die Leitung nicht – weil ein
 * Proxy dazwischen sie kappt oder der Browser sie blockiert –, fallen die
 * Seiten auf ihren alten Takt zurück. Live ist eine Verbesserung, keine
 * Voraussetzung.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const handlers = useRef<Set<(event: LiveEvent) => void>>(new Set());

  useEffect(() => {
    // `EventSource` verbindet sich nach einem Abriss von selbst neu – ein
    // eigener Wiederholmechanismus wäre nur eine schlechtere Kopie davon.
    const quelle = new EventSource(`${API_BASE}/v1/events`, { withCredentials: true });

    const beiNachricht = (nachricht: MessageEvent<string>) => {
      setConnected(true);
      try {
        const daten = JSON.parse(nachricht.data) as LiveEvent;
        // Der Herzschlag hat kein `topic` – er hält nur die Leitung offen.
        if (!daten?.topic) return;
        for (const handler of handlers.current) handler(daten);
      } catch {
        // Unlesbares ignorieren; die Verbindung bleibt.
      }
    };

    quelle.onopen = () => setConnected(true);
    quelle.onmessage = beiNachricht;
    quelle.onerror = () => setConnected(false);

    return () => {
      quelle.close();
      setConnected(false);
    };
  }, []);

  const subscribe = useCallback((handler: (event: LiveEvent) => void) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  // Ohne Provider (etwa im eingebetteten Player) bleibt alles beim Alten.
  return useContext(LiveContext) ?? { connected: false, subscribe: () => () => undefined };
}

/**
 * Auf Ereignisse zu einem Video oder Projekt hören.
 *
 * `onChange` bekommt keinen Inhalt – nur das Signal, neu zu laden. Genau so
 * ist es gedacht: Eine Seite, die ihre Daten schon zu laden weiß, braucht
 * dafür keinen zweiten Weg.
 */
export function useLiveTopic(
  topic: LiveEvent['topic'],
  id: string | null | undefined,
  onChange: () => void,
): void {
  const { subscribe } = useLive();
  const merker = useRef(onChange);
  merker.current = onChange;

  useEffect(() => {
    if (!id) return undefined;
    return subscribe((event) => {
      if (event.topic === topic && event.id === id) merker.current();
    });
  }, [subscribe, topic, id]);
}

/**
 * Der alte Takt als Sicherheitsnetz: Steht die Live-Verbindung, wird deutlich
 * seltener nachgeladen, sonst wie bisher. So bleibt die Oberfläche auch hinter
 * einem Proxy benutzbar, der SSE nicht durchlässt.
 */
export function useFallbackInterval(basis: number | null): number | null {
  const { connected } = useLive();
  if (basis === null) return null;
  return connected ? Math.max(basis, 30_000) : basis;
}
