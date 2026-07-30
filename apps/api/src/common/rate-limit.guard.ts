import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { RateLimiter, type RateLimitRule, rateKey } from './rate-limit';

export const RATE_LIMIT_KEY = 'klappe:rate-limit';

export interface RateLimitOptions extends RateLimitRule {
  /** Name im Schlüssel – trennt die Bremsen verschiedener Routen. */
  name: string;
  /**
   * Feld im Rumpf, das die Person benennt (meist `email`). Ohne Angabe zählt
   * nur die Herkunftsadresse.
   */
  identityField?: string;
}

/**
 * Bremse für eine Route (Phase 13).
 *
 * Beispiel: `@RateLimit({ name: 'login', limit: 10, windowMs: 60_000, identityField: 'email' })`
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);

/** So lange wird ein Schlüssel höchstens vorgehalten, bevor er wegfliegt. */
const SWEEP_WINDOW_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limiter = new RateLimiter();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly reflector: Reflector) {
    this.timer = setInterval(() => this.limiter.sweep(SWEEP_WINDOW_MS), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const body = (request.body ?? {}) as Record<string, unknown>;
    const identity =
      options.identityField && typeof body[options.identityField] === 'string'
        ? (body[options.identityField] as string)
        : null;

    // `trust proxy` steht in main.ts – hinter Caddy oder dem Tunnel liefert
    // `request.ip` damit die echte Adresse und nicht die des Proxys.
    const key = rateKey(options.name, request.ip ?? 'unbekannt', identity);
    const decision = this.limiter.check(key, options);

    response.setHeader('X-RateLimit-Limit', String(options.limit));
    response.setHeader('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      this.logger.warn(`Gebremst: ${key} (${options.limit} je ${options.windowMs / 1000} s)`);
      throw new HttpException(
        `Zu viele Versuche. Bitte in ${decision.retryAfterSeconds} Sekunden noch einmal probieren.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  /** Nach erfolgreicher Anmeldung aufrufen, damit die Bremse nicht nachhängt. */
  clear(name: string, ip: string, identity?: string | null): void {
    this.limiter.reset(rateKey(name, ip, identity));
  }
}
