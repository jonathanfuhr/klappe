import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Mitschrift für die Upload-Endpunkte, zuschaltbar über `UPLOAD_TRACE=1`.
 *
 * Sie beantwortet die eine Frage, an der die Safari-Suche bisher hängen blieb:
 * **Kommt der Block überhaupt an – und wie weit?** Ohne sie schweigt die API
 * bei einem gelungenen Block genauso wie bei einem, der nie eintrifft; „nichts
 * im Log“ ließ sich deshalb nicht deuten.
 *
 * Drei Zeilen pro Block:
 *
 * - **beim Eintreffen** – damit steht fest, dass die Anfrage den Weg durch die
 *   Next-Weiterleitung geschafft hat,
 * - **alle 10 Sekunden, solange der Body nicht vollständig ist** – mit der
 *   Byteposition. Ein Upload, der scheinbar „hängt“, schreibt hier entweder
 *   stetig wachsende Zahlen (dann fließt er, nur langsam) oder immer dieselbe
 *   (dann steht er wirklich),
 * - **am Ende** – mit Dauer, Statuscode und der Angabe, ob der Body vollständig
 *   war.
 *
 * Bewusst ohne `req.on('data')`: Ein Datenhorcher würde den Strom in den
 * fließenden Zustand versetzen und dem eigentlichen Empfänger die Bytes
 * wegnehmen. Gezählt wird deshalb am Socket, dessen `bytesRead` ohnehin
 * mitläuft.
 */
export function uploadTrace(): (req: Request, res: Response, next: NextFunction) => void {
  const logger = new Logger('UploadTrace');

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/v1/uploads')) {
      next();
      return;
    }

    const start = Date.now();
    // `bytesRead` zählt alles, was über diese Verbindung kam – bei Keep-Alive
    // also auch frühere Anfragen. Nur die Differenz ist aussagekräftig.
    const socketStart = req.socket.bytesRead;
    const angekuendigt = Number(req.headers['content-length'] ?? 0);
    const kennung = `${req.method} ${req.path}`;
    const offset = req.headers['upload-offset'] ?? '-';

    logger.log(
      `${kennung} eingetroffen – Upload-Offset ${offset}, Content-Length ${angekuendigt || '-'}, ` +
        `von ${req.socket.remoteAddress ?? 'unbekannt'}`,
    );

    const empfangen = (): number => Math.max(0, req.socket.bytesRead - socketStart);

    const uhr =
      angekuendigt > 0
        ? setInterval(() => {
            if (req.complete) return;
            logger.warn(
              `${kennung} steht seit ${Math.round((Date.now() - start) / 1000)}s bei ` +
                `${empfangen()} von ${angekuendigt} Byte. Wächst die Zahl nicht, holt niemand ` +
                'die Daten ab – der Browser hat sie längst abgegeben.',
            );
          }, 10_000)
        : null;
    // Ohne das hält der Timer den Prozess beim Herunterfahren offen.
    if (uhr) uhr.unref();

    let fertig = false;
    const abschluss = (): void => {
      if (fertig) return;
      fertig = true;
      if (uhr) clearInterval(uhr);

      const dauer = (Date.now() - start) / 1000;

      // `req.complete` ist die ehrliche Auskunft darüber, ob der Body ganz da
      // war. Fehlt er, hat der Client mittendrin losgelassen – oder wir.
      //
      // Nur dann wird die Byteposition gemeldet, und zwar bewusst: Der Zähler
      // sitzt am Socket, und bei einer kleinen Anfrage liegt deren Body schon
      // vollständig im Puffer, bevor diese Mitschrift überhaupt läuft. Die
      // Differenz wäre dann 0 – ein „0 Byte empfangen" unter einem gelungenen
      // `POST` schickt den Nächsten auf eine falsche Fährte. Wo die Zahl zählt,
      // nämlich bei einem abgerissenen Block, stimmt sie.
      if (angekuendigt > 0 && !req.complete) {
        logger.warn(
          `${kennung} abgebrochen nach ${dauer.toFixed(1)}s – HTTP ${res.statusCode}, ` +
            `Body UNVOLLSTÄNDIG bei rund ${empfangen()} von ${angekuendigt} Byte.`,
        );
        return;
      }
      logger.log(
        `${kennung} beendet nach ${dauer.toFixed(1)}s – HTTP ${res.statusCode}` +
          (angekuendigt > 0 ? `, ${angekuendigt} Byte vollständig empfangen` : ''),
      );
    };

    res.on('finish', abschluss);
    res.on('close', abschluss);
    next();
  };
}
