import { type NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'klappe_session';

/**
 * Grobe Weiche: Wer kein Sitzungs-Cookie hat, landet auf dem Login, ohne dass
 * erst eine leere Oberfläche aufblitzt. Die eigentliche Prüfung macht die API –
 * hier wird bewusst nur auf Vorhandensein geschaut, nicht auf Gültigkeit.
 */
/**
 * Ohne Anmeldung erreichbar: der Einstieg für Gäste über einen Freigabe-Link
 * und der Abmelde-Link aus den Benachrichtigungen.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/abmelden' ||
    pathname.startsWith('/f/') ||
    // Eingebettete Player laufen ohne Sitzung – eine Weiterleitung aufs Login
    // erschiene sonst mitten in der fremden Seite.
    pathname.startsWith('/einbetten/')
  );
}

export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(COOKIE_NAME);
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === '/login';

  if (!hasSession && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?weiter=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (hasSession && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/projekte';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Statische Dateien und die API-Weiterleitung bleiben außen vor.
   *
   * Das Web-App-Manifest gehört ausdrücklich dazu (Phase 24): Der Browser holt
   * es ohne Sitzungs-Cookie, und eine Weiterleitung aufs Login käme dort als
   * unlesbares Manifest an – das iPhone legte dann wieder eine Kachel ohne
   * Symbol an.
   */
  matcher: [
    '/((?!_next/static|_next/image|v1/|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
