'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotificationBell } from '@/components/NotificationBell';
import { Menu, MenuItem, MenuLink, MenuSeparator } from '@/components/ui/Menu';
import { useBranding } from '@/lib/branding';
import { initialsOf } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useSession();
  const { branding } = useBranding();
  const pathname = usePathname();
  const t = useT();
  const istTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';

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

        {/* Seit Phase 24 trägt die Kopfzeile nur noch, was täglich gebraucht
            wird. Handbuch, „Über diese Software" und die Einstellungen sind ins
            Benutzer-Menü rechts gewandert – auf dem Handy brach die Reihe sonst
            in eine zweite, rollbare Zeile um. */}
        <nav className="shell__nav">
          <Link href="/projekte" data-active={pathname.startsWith('/projekte')}>
            {t('shell.projects')}
          </Link>
        </nav>

        <div className="shell__spacer" />

        {user ? (
          <div className="shell__user">
            {/* Die Zentrale gilt für alle Angemeldeten – auch Gäste werden
                erwähnt und bekommen Antworten (Phase 18). */}
            <NotificationBell />
            {/*
             * Der Klick aufs Namenskürzel führte bisher stur auf die
             * Konto-Seite; wer die Einstellungen suchte, landete beim Passwort.
             * Jetzt öffnet er ein Menü. Auf dem Handy bleibt davon nur das
             * Kürzel stehen – der ausgeschriebene Name fraß die halbe Zeile.
             */}
            <Menu
              label={t('shell.userMenu')}
              triggerClassName="usermenu"
              trigger={
                <>
                  <span className="avatar" aria-hidden>
                    {initialsOf(user.name)}
                  </span>
                  <span className="usermenu__name">{user.name}</span>
                  {user.role === 'GUEST' ? <span className="badge">{t('shell.guestBadge')}</span> : null}
                </>
              }
            >
              <div className="menu__head">
                <strong>{user.name}</strong>
                <span className="faint">{user.email}</span>
              </div>
              <MenuSeparator />
              {/* Gäste haben kein Passwort, aber seit Phase 21 trotzdem ein
                  Konto mit Namen – die Seite gilt für beide Rollen. */}
              <MenuLink href="/konto" active={pathname.startsWith('/konto')}>
                {t('shell.profile')}
              </MenuLink>
              {/* Für Team und Gäste gleichermaßen gedacht – anders als die
                  Einstellungen, die dem Team vorbehalten bleiben. */}
              <MenuLink href="/handbuch" active={pathname.startsWith('/handbuch')}>
                {t('shell.manual')}
              </MenuLink>
              <MenuLink href="/ueber" active={pathname.startsWith('/ueber')}>
                {t('shell.about')}
              </MenuLink>
              {istTeam ? (
                <MenuLink href="/einstellungen" active={pathname.startsWith('/einstellungen')}>
                  {t('shell.settings')}
                </MenuLink>
              ) : null}
              <MenuSeparator />
              <MenuItem onSelect={() => void logout()}>{t('shell.logout')}</MenuItem>
            </Menu>
          </div>
        ) : null}
      </header>

      <main className="shell__main">{children}</main>
    </div>
  );
}
