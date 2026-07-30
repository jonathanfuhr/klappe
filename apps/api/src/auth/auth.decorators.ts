import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { UserRole } from '@klappe/shared';
import type { AuthenticatedRequest, RequestUser } from './auth.types';

import type { MediaKind } from '../media/media-token';

export const IS_PUBLIC_KEY = 'klappe:isPublic';
export const ROLES_KEY = 'klappe:roles';
export const MEDIA_TOKEN_KEY = 'klappe:mediaToken';

/** Hebt den global aktiven Login-Zwang für einzelne Routen auf. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Lässt zusätzlich zur Sitzung einen kurzlebigen Medien-Token in `?t=` gelten
 * (Phase 13). Die Art muss zur Route passen: Ein Token fürs Vorschaubild
 * schaltet nicht das Original frei.
 *
 * Die Rechteprüfung im Controller bleibt davon unberührt – der Token weist
 * nur die Person aus, er ersetzt keine Freigabe.
 */
export const AllowMediaToken = (kind: MediaKind) => SetMetadata(MEDIA_TOKEN_KEY, kind);

/** Beschränkt eine Route auf bestimmte Rollen. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
