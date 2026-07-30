'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { useBranding } from '@/lib/branding';
import { initialsOf } from '@/lib/format';
import { useSession } from '@/lib/session';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const { branding } = useBranding();
  const pathname = usePathname();

  return (
    <div className="shell">
      <header className="shell__header">
        <Link href={user?.role === 'GUEST' ? '#' : '/projekte'} className="shell__brand">
          {branding.logoUrl ? (
            // Bewusst als <img>: Ein hochgeladenes SVG kann Skripte enthalten,
            // die hier nicht ausgeführt werden.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="shell__brand-logo" src={branding.logoUrl} alt={branding.title} />
          ) : (
            <span className="shell__brand-mark" aria-hidden>
              ◗
            </span>
          )}
          {branding.title}
        </Link>

        <nav className="shell__nav">
          <Link href="/projekte" data-active={pathname.startsWith('/projekte')}>
            Projekte
          </Link>
          {/* Für Team und Gäste gleichermaßen gedacht – anders als
              „Einstellungen" unten, das dem Team vorbehalten bleibt. */}
          <Link href="/handbuch" data-active={pathname.startsWith('/handbuch')}>
            Handbuch
          </Link>
          <Link href="/ueber" data-active={pathname.startsWith('/ueber')}>
            Über diese Software
          </Link>
          {/* Gäste und Benutzer stehen seit Phase 17 in den Einstellungen –
              die Kopfzeile trägt nur noch, was täglich gebraucht wird. */}
          {user?.role === 'ADMIN' || user?.role === 'MEMBER' ? (
            <Link href="/einstellungen" data-active={pathname.startsWith('/einstellungen')}>
              Einstellungen
            </Link>
          ) : null}
        </nav>

        <div className="shell__spacer" />

        {user ? (
          <div className="shell__user">
            {/* Die Zentrale gilt für alle Angemeldeten – auch Gäste werden
                erwähnt und bekommen Antworten (Phase 18). */}
            <NotificationBell />
            <span className="avatar" title={user.email}>
              {initialsOf(user.name)}
            </span>
            {/* Gäste haben kein Passwort, aber seit Phase 21 trotzdem ein Konto
                mit Namen – der Link führt beiden Rollen zur selben Seite. */}
            <Link href="/konto" className="muted" data-active={pathname.startsWith('/konto')}>
              {user.name}
            </Link>
            {user.role === 'GUEST' ? <span className="badge">Gast</span> : null}
            <button type="button" className="button button--ghost" onClick={() => void logout()}>
              Abmelden
            </button>
          </div>
        ) : null}
      </header>

      <main className="shell__main">{children}</main>
    </div>
  );
}
