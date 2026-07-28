'use client';

import type { EmbedDto } from '@klappe/shared';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';

/**
 * Der eingebettete Player.
 *
 * Absichtlich karg: keine Navigation, keine Kommentare, keine Anmeldung. Diese
 * Seite steht in einem `iframe` auf einer fremden Seite, und dort kann sie
 * keine Sitzung mitbringen – Browser blockieren Cookies von Drittanbietern.
 * Alles, was sie braucht, steckt im Token in der Adresse.
 *
 * Deshalb auch die schlichten Bedienelemente des Browsers statt des großen
 * Review-Players: Frame-Genauigkeit und Tastenkürzel gehören in die
 * Freigabeansicht, nicht in ein Fenster von 400 Pixeln Breite auf einer
 * fremden Seite.
 */
export default function EmbedPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [daten, setDaten] = useState<EmbedDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    void fetch(`${API_BASE}/v1/embed/${encodeURIComponent(token)}`)
      .then(async (antwort) => {
        if (!antwort.ok) throw new Error('Diese Einbettung gibt es nicht (mehr).');
        return (await antwort.json()) as EmbedDto;
      })
      .then((wert) => {
        if (!abgebrochen) setDaten(wert);
      })
      .catch((ladefehler: unknown) => {
        if (!abgebrochen) {
          setFehler(ladefehler instanceof Error ? ladefehler.message : 'Nicht verfügbar.');
        }
      });
    return () => {
      abgebrochen = true;
    };
  }, [token]);

  if (fehler) {
    return (
      <div className="embed embed--leer">
        <p>{fehler}</p>
      </div>
    );
  }

  if (!daten) {
    return (
      <div className="embed embed--leer">
        <p>Wird geladen …</p>
      </div>
    );
  }

  const basis = `${API_BASE}/v1/embed/${encodeURIComponent(token)}/versions/${daten.versionId}`;

  return (
    <div className="embed">
      {/* Ohne `controls` gäbe es hier keine Bedienung – wir bringen keine
          eigene mit, damit der Player auch in einem schmalen Rahmen brauchbar
          bleibt. */}
      <video
        className="embed__video"
        src={`${basis}/proxy`}
        poster={daten.hasPoster ? `${basis}/poster` : undefined}
        controls
        playsInline
        preload="metadata"
      />
      <div className="embed__bar">
        <span className="embed__title" title={daten.title}>
          {daten.title}
        </span>
        <span className="embed__version">{daten.versionLabel}</span>
        <span className="embed__spacer" />
        <span className="embed__brand">{daten.brandTitle}</span>
      </div>
    </div>
  );
}
