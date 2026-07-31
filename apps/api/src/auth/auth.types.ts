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
  /**
   * Gesetzt, wenn die Anfrage über einen API-Token kam (Phase 25) – nicht
   * über den Browser. Für die Rechte macht das keinen Unterschied; die
   * Angabe steht für Protokolle und für Routen, die einer Anbindung etwas
   * verwehren wollen, das nur am Bildschirm sinnvoll ist.
   */
  apiTokenId?: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}
