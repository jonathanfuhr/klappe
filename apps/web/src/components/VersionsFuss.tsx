'use client';

import type { BuildInfoDto } from '@klappe/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Der Stand dieser Anlage, klein am Fuß der Einstellungen (1.5.1).
 *
 * Wer in den Einstellungen sitzt und sich fragt, ob eine Änderung überhaupt
 * schon ausgerollt ist, soll die Antwort dort sehen, wo er gerade ist. Die
 * ausführliche Fassung – mit Bauzeitpunkt und dem Hinweis auf auseinander
 * laufende Hälften – steht unter „Über diese Software"; hier genügt eine
 * Zeile.
 */
export function VersionsFuss() {
  const t = useT();
  const [build, setBuild] = useState<BuildInfoDto | null>(null);

  useEffect(() => {
    // Ohne Antwort bleibt die Zeile weg: Eine Fehlermeldung wegen einer
    // Versionsanzeige wäre in den Einstellungen nur Lärm.
    void api
      .getAbout()
      .then((about) => setBuild(about.build))
      .catch(() => setBuild(null));
  }, []);

  if (!build) return null;

  return (
    <p className="faint" style={{ fontSize: 12, marginTop: 20, textAlign: 'right' }}>
      <Link href="/ueber">
        {t('about.versionFooter', {
          version: build.version,
          commit: build.commit ?? '–',
        })}
      </Link>
    </p>
  );
}
