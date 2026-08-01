/**
 * Adressen der Web-Oberfläche (Phase 27).
 *
 * Die API legt sie als `webUrl` an `VideoDto` und `VersionDto` – damit eine
 * fremde Anbindung nach dem Hochladen „Im Browser öffnen“ anbieten kann, ohne
 * die Routen der Web-App zu raten. Bewusst **relativ** zur Instanz: Wer eine
 * Absolutadresse braucht, hängt seine eigene Basis davor; so bleibt der Wert
 * auch dann richtig, wenn dieselbe Instanz über Tailscale und über die
 * öffentliche Adresse erreichbar ist.
 *
 * Beide Seiten holen sich die Pfade hier, damit ein Umbau der Routen nicht an
 * einer Stelle nachgezogen wird und an der anderen nicht.
 */
import { formatVersionNumber } from './versions';

/** Der Suchparameter, mit dem die Videoseite eine bestimmte Fassung öffnet. */
export const VERSION_QUERY_PARAM = 'fassung';

export function videoWebPath(videoId: string): string {
  return `/videos/${videoId}`;
}

/**
 * Die Videoseite mit vorgewählter Fassung. Angesprochen wird sie über die
 * **Nummer**, nicht über die ID: Die steht auch in der Adresszeile lesbar da
 * (`?fassung=2.5`), und wer den Link weitergibt, sieht sofort, worum es geht.
 */
export function versionWebPath(videoId: string, versionNumber: number): string {
  return `${videoWebPath(videoId)}?${VERSION_QUERY_PARAM}=${formatVersionNumber(versionNumber)}`;
}
