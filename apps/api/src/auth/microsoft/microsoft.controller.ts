import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimit } from '../../common/rate-limit.guard';
import { AppConfig, CONFIG } from '../../config/configuration';
import { AuthService } from '../auth.service';
import { Public } from '../auth.decorators';
import { MICROSOFT_FLOW_COOKIE, MicrosoftAuthService } from './microsoft.service';

/**
 * Anmeldung über Microsoft 365 (Phase 11).
 *
 * Beide Routen sind Weiterleitungen im Browser, keine JSON-Schnittstelle –
 * der Benutzer wandert zu Microsoft und kommt mit einem Code zurück. Fehler
 * landen deshalb als Text in der Adresse der Anmeldeseite und nicht als
 * HTTP-Fehler, den niemand zu sehen bekäme.
 */
@Controller('v1/auth/microsoft')
export class MicrosoftAuthController {
  constructor(
    private readonly microsoft: MicrosoftAuthService,
    private readonly authService: AuthService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @RateLimit({ name: 'm365-start', limit: 30, windowMs: 60 * 60 * 1000 })
  @Get('start')
  async start(
    @Query('redirect') redirect: string | undefined,
    @Query('hint') hint: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const { url, cookie } = await this.microsoft.begin({ redirect, loginHint: hint });

      response.cookie(MICROSOFT_FLOW_COOKIE, cookie, {
        httpOnly: true,
        secure: this.config.jwt.cookieSecure,
        // `lax` genügt und ist nötig: Die Rückkehr von Microsoft ist eine
        // Navigation von außen, bei `strict` käme der Keks nicht mit.
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60 * 1000,
      });

      response.redirect(url);
    } catch (error) {
      response.redirect(this.errorUrl(error));
    }
  }

  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Query('error_description') oauthErrorDescription: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    // Der Keks hat seinen Zweck erfüllt, egal wie es ausgeht.
    response.clearCookie(MICROSOFT_FLOW_COOKIE, { path: '/' });

    if (oauthError) {
      response.redirect(this.errorUrl(oauthErrorDescription || oauthError));
      return;
    }
    if (!code || !state) {
      response.redirect(this.errorUrl('Die Antwort von Microsoft war unvollständig.'));
      return;
    }

    try {
      const { user, redirect } = await this.microsoft.complete({
        code,
        state,
        cookie: request.cookies?.[MICROSOFT_FLOW_COOKIE] as string | undefined,
      });

      const token = await this.authService.issueToken(user);
      response.cookie(this.config.jwt.cookieName, token, {
        httpOnly: true,
        secure: this.config.jwt.cookieSecure,
        sameSite: 'lax',
        path: '/',
        maxAge: this.config.jwt.ttlSeconds * 1000,
      });

      response.redirect(`${this.config.publicUrl.replace(/\/+$/, '')}${redirect}`);
    } catch (error) {
      response.redirect(this.errorUrl(error));
    }
  }

  /** Zurück zur Anmeldeseite, mit lesbarer Begründung in der Adresse. */
  private errorUrl(error: unknown): string {
    const message =
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? messageOf(error)
          : 'Die Anmeldung über Microsoft 365 hat nicht geklappt.';

    return `${this.config.publicUrl.replace(/\/+$/, '')}/login?fehler=${encodeURIComponent(message)}`;
  }
}

/** Nest-Ausnahmen tragen die eigentliche Meldung in `response.message`. */
function messageOf(error: Error): string {
  const response = (error as { response?: { message?: string | string[] } }).response;
  const message = response?.message;
  if (Array.isArray(message)) return message.join(' ');
  return message ?? error.message;
}
