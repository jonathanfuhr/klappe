import { type NextRequest, NextResponse } from 'next/server';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'klappe_session';

/**
 * Grobe Weiche: Wer kein Sitzungs-Cookie hat, landet auf dem Login, ohne dass
 * erst eine leere Oberfläche aufblitzt. Die eigentliche Prüfung macht die API –
 * hier wird bewusst nur auf Vorhandensein geschaut, nicht auf Gültigkeit.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(COOKIE_NAME);
  const { pathname, search } = request.nextUrl;
  const isLoginPage = pathname === '/login';

  if (!hasSession && !isLoginPage) {
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
  // Statische Dateien und die API-Weiterleitung bleiben außen vor.
  matcher: ['/((?!_next/static|_next/image|v1/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
};
