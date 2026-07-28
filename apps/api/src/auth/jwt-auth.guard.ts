import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@klappe/shared';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { type MediaKind, readMediaToken } from '../media/media-token';
import { IS_PUBLIC_KEY, MEDIA_TOKEN_KEY, ROLES_KEY } from './auth.decorators';
import type { AuthenticatedRequest, JwtPayload } from './auth.types';

/**
 * Global aktiver Guard: ohne gültige Sitzung kommt keine Anfrage durch.
 * Ausnahmen werden mit `@Public()` markiert, Rollen mit `@Roles()`.
 *
 * Der Benutzer wird bei jeder Anfrage frisch aus der Datenbank geladen –
 * so wirkt das Deaktivieren eines Kontos sofort und nicht erst, wenn das
 * Token abläuft.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const userId = await this.identify(context, request);

    const [user] = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Konto existiert nicht mehr oder ist deaktiviert.');
    }

    request.user = { id: user.id, email: user.email, name: user.name, role: user.role };

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Für diese Aktion fehlen die Rechte.');
    }

    return true;
  }

  /**
   * Wer stellt die Anfrage? Normalfall ist die Sitzung. Auf ausdrücklich
   * dafür markierten Medien-Routen gilt ersatzweise ein kurzlebiger Token in
   * `?t=` – gebunden an genau diese Fassung und genau diese Art von Datei.
   */
  private async identify(
    context: ExecutionContext,
    request: AuthenticatedRequest,
  ): Promise<string> {
    const sessionToken = extractToken(request, this.config.jwt.cookieName);
    if (sessionToken) {
      try {
        const payload = await this.jwtService.verifyAsync<JwtPayload>(sessionToken, {
          secret: this.config.jwt.secret,
        });
        return payload.sub;
      } catch {
        throw new UnauthorizedException('Sitzung abgelaufen oder ungültig.');
      }
    }

    const erlaubteArt = this.reflector.getAllAndOverride<MediaKind | undefined>(MEDIA_TOKEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (erlaubteArt) {
      const media = readMediaToken(
        (request.query as Record<string, string | undefined>)?.t,
        this.config.jwt.secret,
      );
      // Ohne die Bindung an Fassung und Art wäre ein Link fürs Vorschaubild
      // ein Ausweis für alles Übrige.
      if (
        media &&
        media.kind === erlaubteArt &&
        media.versionId === (request.params as Record<string, string>)?.id
      ) {
        return media.userId;
      }
    }

    throw new UnauthorizedException('Nicht angemeldet.');
  }
}

/**
 * Sitzungs-Cookie ist der Normalfall (Browser). Der Bearer-Header bleibt für
 * Skripte und spätere Integrationen offen.
 */
export function extractToken(request: Request, cookieName: string): string | null {
  const cookieToken = (request.cookies as Record<string, string> | undefined)?.[cookieName];
  if (cookieToken) return cookieToken;

  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const value = header.slice('Bearer '.length).trim();
    if (value) return value;
  }
  return null;
}
