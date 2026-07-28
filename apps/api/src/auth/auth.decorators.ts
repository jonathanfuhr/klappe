import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { UserRole } from '@klappe/shared';
import type { AuthenticatedRequest, RequestUser } from './auth.types';

export const IS_PUBLIC_KEY = 'klappe:isPublic';
export const ROLES_KEY = 'klappe:roles';

/** Hebt den global aktiven Login-Zwang für einzelne Routen auf. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Beschränkt eine Route auf bestimmte Rollen. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
