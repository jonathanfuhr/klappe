/** Was als Video durchgeht; für die Kunden-Ablage gilt keine Einschränkung. */
export const VIDEO_ACCEPT = 'video/*,.mov,.mp4,.mxf,.mkv,.avi,.m4v';

/**
 * Dateiauswahl ohne sichtbares Eingabefeld (Phase 24).
 *
 * Ein `<input type="file">` lässt sich nur durch einen Klick öffnen, und der
 * muss aus einer echten Benutzeraktion kommen. Für Stellen, die gar kein
 * Ablagefeld zeigen sollen – das „+" für eine neue Fassung etwa –, wird das
 * Feld hier kurz angelegt, angeklickt und wieder entfernt.
 */
export function pickFiles({
  accept,
  multiple = true,
  directory = false,
}: {
  accept?: string;
  multiple?: boolean;
  /** `webkitdirectory`: liefert jede Datei mit ihrem relativen Pfad. */
  directory?: boolean;
} = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    if (directory) input.setAttribute('webkitdirectory', '');
    input.hidden = true;

    const fertig = (files: File[]) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => fertig(Array.from(input.files ?? [])), { once: true });
    // Wer abbricht, löst kein `change` aus; ohne das hier bliebe der Knoten
    // für immer im Dokument stehen.
    input.addEventListener('cancel', () => fertig([]), { once: true });

    document.body.append(input);
    input.click();
  });
}
