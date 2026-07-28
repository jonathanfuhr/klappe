'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { initialsOf } from '@/lib/format';
import { useSession } from '@/lib/session';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const pathname = usePathname();

  return (
    <div className="shell">
      <header className="shell__header">
        <Link href="/projekte" className="shell__brand">
          <span className="shell__brand-mark" aria-hidden>
            ◗
          </span>
          Klappe
        </Link>

        <nav className="shell__nav">
          <Link href="/projekte" data-active={pathname.startsWith('/projekte')}>
            Projekte
          </Link>
          {user?.role === 'ADMIN' ? (
            <Link href="/benutzer" data-active={pathname.startsWith('/benutzer')}>
              Benutzer
            </Link>
          ) : null}
        </nav>

        <div className="shell__spacer" />

        {user ? (
          <div className="shell__user">
            <span className="avatar" title={user.email}>
              {initialsOf(user.name)}
            </span>
            <span className="muted">{user.name}</span>
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
