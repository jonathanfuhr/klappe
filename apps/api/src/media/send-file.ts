import type { Response } from 'express';
import type { Readable } from 'node:stream';
import { parseRange } from './range';

/**
 * Auslieferung einer Datei mit `Range`-Unterstützung.
 *
 * Ausgelagert, weil sowohl die Medien der Videoversionen als auch die
 * Kundendateien denselben Weg gehen – und ein zweiter, leicht abweichender
 * Streaming-Pfad wäre genau die Stelle, an der Videos in Safari plötzlich
 * nicht mehr springen.
 */
export function sendFile(input: {
  response: Response;
  stream: (options?: { start?: number; end?: number }) => Readable;
  size: number;
  contentType: string;
  rangeHeader: string | undefined;
  cacheControl: string;
}): void {
  const { response, size } = input;

  response.setHeader('Content-Type', input.contentType);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Cache-Control', input.cacheControl);

  const range = parseRange(input.rangeHeader, size);

  if (range.kind === 'unsatisfiable') {
    response.status(416).setHeader('Content-Range', `bytes */${size}`);
    response.end();
    return;
  }

  if (range.kind === 'full') {
    response.status(200).setHeader('Content-Length', String(size));
    if (response.req.method === 'HEAD') {
      response.end();
      return;
    }
    input.stream().pipe(response);
    return;
  }

  response.status(206);
  response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  response.setHeader('Content-Length', String(range.length));
  if (response.req.method === 'HEAD') {
    response.end();
    return;
  }
  input.stream({ start: range.start, end: range.end }).pipe(response);
}
