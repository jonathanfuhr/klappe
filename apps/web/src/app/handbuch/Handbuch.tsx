'use client';

import { AppShell } from '@/components/AppShell';
import { SectionNav } from '@/components/ui/SectionNav';
import { useLocale, useT } from '@/lib/i18n';
import { ABSCHNITTE_DE, HandbuchDe } from './inhalt-de';
import { ABSCHNITTE_EN, HandbuchEn } from './inhalt-en';

/**
 * Handbuch für Benutzer und Gäste.
 *
 * Bewusst für alle Angemeldeten offen, auch für Gäste – anders als die
 * Verwaltungsseiten unter „Einstellungen".
 *
 * Seit Phase 26 zweisprachig: Der Rahmen ist derselbe, der Inhalt kommt je
 * Sprache aus einer eigenen Datei. Die Anker (`#anmelden`, `#player` …) sind in
 * beiden gleich, damit ein verschickter Link auch dann noch trifft, wenn der
 * Empfänger die andere Sprache eingestellt hat.
 */
export function Handbuch() {
  const t = useT();
  const locale = useLocale();
  const englisch = locale === 'en';

  return (
    <AppShell>
      <div className="page settingspage">
        <SectionNav
          title={t('manual.title')}
          items={englisch ? ABSCHNITTE_EN : ABSCHNITTE_DE}
        />

        <div className="settingspage__body">
          <h1 className="page__title settingspage__heading">{t('manual.title')}</h1>
          <p className="page__subtitle">{t('manual.subtitle')}</p>

          <div className="manual">{englisch ? <HandbuchEn /> : <HandbuchDe />}</div>
        </div>
      </div>
    </AppShell>
  );
}
