import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { LocaleService } from './locale.service';
import { translateMessage } from './translate';

/**
 * Übersetzt die Meldung jeder abgewiesenen Anfrage (Phase 26).
 *
 * Er sitzt ganz außen und lässt Status und Aufbau der Antwort unangetastet –
 * ausgetauscht wird allein der Text. Für Deutsch fällt er faktisch aus, und
 * was nicht im Katalog steht, geht unverändert hinaus.
 *
 * Dass hier übersetzt wird und nicht am Wurfort, hat einen einfachen Grund:
 * Erst hier steht fest, wer fragt – und damit, in welcher Sprache er liest.
 */
@Catch(HttpException)
export class UebersetzenderFehlerfilter implements ExceptionFilter {
  constructor(private readonly locales: LocaleService) {}

  async catch(exception: HttpException, host: ArgumentsHost): Promise<void> {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const status = exception.getStatus();
    const inhalt = exception.getResponse();
    const locale = await this.locales.forRequest(request);

    // Nest gibt je nach Wurfart einen nackten Text oder ein Objekt heraus.
    if (typeof inhalt === 'string') {
      response.status(status).json({ statusCode: status, message: translateMessage(inhalt, locale) });
      return;
    }

    const koerper = inhalt as Record<string, unknown>;
    const meldung = koerper.message;

    // Die Prüf-Pipe schickt eine Liste; dann wird jeder Eintrag einzeln
    // nachgeschlagen.
    const uebersetzt = Array.isArray(meldung)
      ? meldung.map((eintrag) =>
          typeof eintrag === 'string' ? translateMessage(eintrag, locale) : eintrag,
        )
      : typeof meldung === 'string'
        ? translateMessage(meldung, locale)
        : meldung;

    response.status(status).json({ ...koerper, message: uebersetzt });
  }
}
