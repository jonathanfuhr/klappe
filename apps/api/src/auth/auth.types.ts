import type { UserRole } from '@klappe/shared';
import type { Request } from 'express';

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
