import { APP_ICON_SIZE } from '@klappe/shared';

/**
 * Aus dem Logo (oder dem eigenen Tab-Symbol) ein quadratisches PNG machen
 * (Phase 24).
 *
 * Warum überhaupt: Ein SVG nimmt der iOS-Startbildschirm als App-Symbol gar
 * nicht an, und in Browser-Tabs ist es nur in neueren Fassungen zuverlässig.
 * Wer ein SVG-Logo hochlädt, hatte deshalb bisher schlicht kein Symbol.
 *
 * Warum im Browser: Serverseitig zu rastern hieße, eine Bildbibliothek mit
 * nativen Abhängigkeiten in ein Image zu holen, das sonst nur Node und ffmpeg
 * enthält – und die Verarbeitung für zwei Kilobyte PNG über den Worker zu
 * schicken. Ein Canvas kann das schon, und beim Hochladen sitzt ohnehin jemand
 * davor.
 */
export async function rasterizeAppIcon(quelle: string): Promise<Blob> {
  const bild = await ladeBild(quelle);

  const canvas = document.createElement('canvas');
  canvas.width = APP_ICON_SIZE;
  canvas.height = APP_ICON_SIZE;

  const kontext = canvas.getContext('2d');
  if (!kontext) throw new Error('Dieser Browser kann kein Bild zeichnen.');

  /*
   * Das Bild wird eingepasst, nicht beschnitten: Ein breites Schriftzug-Logo
   * soll klein, aber vollständig zu sehen sein – lieber Luft oben und unten
   * als ein Symbol, das nur die mittleren Buchstaben zeigt. Der Grund bleibt
   * durchsichtig; das PNG legt sich damit auf jeden Tab-Hintergrund.
   */
  const breite = bild.naturalWidth || APP_ICON_SIZE;
  const hoehe = bild.naturalHeight || APP_ICON_SIZE;
  // Etwas Rand, sonst klebt das Motiv auf dem Startbildschirm an der Kante.
  const platz = APP_ICON_SIZE * 0.92;
  const faktor = Math.min(platz / breite, platz / hoehe);
  const zielBreite = breite * faktor;
  const zielHoehe = hoehe * faktor;

  kontext.drawImage(
    bild,
    (APP_ICON_SIZE - zielBreite) / 2,
    (APP_ICON_SIZE - zielHoehe) / 2,
    zielBreite,
    zielHoehe,
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Das Symbol ließ sich nicht erzeugen.'))),
      'image/png',
    );
  });
}

/**
 * Bild laden und auf das `load`-Ereignis warten.
 *
 * `crossOrigin` bleibt ungesetzt: Die Adresse zeigt immer auf die eigene
 * Herkunft (`/v1/branding/…`), der Canvas wird dadurch nicht unrein und
 * `toBlob` bleibt erlaubt.
 */
function ladeBild(quelle: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const bild = new Image();
    bild.addEventListener('load', () => resolve(bild), { once: true });
    bild.addEventListener(
      'error',
      () => reject(new Error('Das Bild ließ sich nicht laden.')),
      { once: true },
    );
    bild.src = quelle;
  });
}
