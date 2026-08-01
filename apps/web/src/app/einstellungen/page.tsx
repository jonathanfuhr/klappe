'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AiPanel } from '@/components/settings/AiPanel';
import { ApiAccessPanel } from '@/components/settings/ApiAccessPanel';
import { AuthPanel } from '@/components/settings/AuthPanel';
import { BackupPanel } from '@/components/settings/BackupPanel';
import { BrandingPanel } from '@/components/settings/BrandingPanel';
import { FieldsPanel } from '@/components/settings/FieldsPanel';
import { GuestsPanel } from '@/components/settings/GuestsPanel';
import { ProjectsPanel } from '@/components/settings/ProjectsPanel';
import { SmtpPanel } from '@/components/settings/SmtpPanel';
import { StoragePanel } from '@/components/settings/StoragePanel';
import { TranscodePanel } from '@/components/settings/TranscodePanel';
import { UsersPanel } from '@/components/settings/UsersPanel';
import { SectionNav } from '@/components/ui/SectionNav';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * Die Bereiche der Einstellungen (Phase 17). Senkrecht statt waagerecht, weil
 * die Liste weiter wächst – Reiter in einer Zeile wären längst umgebrochen.
 *
 * `team: true` heißt: auch Mitglieder dürfen hinein. Alles andere ist
 * Admin-Sache.
 */
const BEREICHE = [
  { id: 'gaeste', schluessel: 'settings.navGuests', team: true },
  { id: 'benutzer', schluessel: 'settings.navUsers', team: false },
  { id: 'felder', schluessel: 'settings.navFields', team: false },
  { id: 'projekte', schluessel: 'settings.navProjects', team: false },
  { id: 'ki', schluessel: 'settings.navAi', team: false },
  { id: 'branding', schluessel: 'settings.navBranding', team: false },
  { id: 'auth', schluessel: 'settings.navAuth', team: false },
  { id: 'api', schluessel: 'settings.navApi', team: false },
  { id: 'mail', schluessel: 'settings.navMail', team: false },
  { id: 'transcode', schluessel: 'settings.navTranscode', team: false },
  { id: 'speicher', schluessel: 'settings.navStorage', team: false },
  { id: 'sicherung', schluessel: 'settings.navBackup', team: false },
] as const;

type BereichId = (typeof BEREICHE)[number]['id'];

/** Einstellungen des Workspace – Verwaltung und alles Workspace-Weite. */
export default function SettingsPage() {
  const t = useT();
  const { user, loading } = useSession();
  const istAdmin = user?.role === 'ADMIN';
  const istTeam = istAdmin || user?.role === 'MEMBER';
  // Die Beschriftungen entstehen erst hier, damit sie der gewählten Sprache
  // folgen – die Liste oben trägt nur die Schlüssel (Phase 26).
  const sichtbar = BEREICHE.filter((bereich) => (istAdmin ? true : bereich.team)).map(
    (bereich) => ({ ...bereich, label: t(bereich.schluessel) }),
  );
  // Mitglieder landen auf dem ersten Bereich, den sie sehen dürfen.
  const [bereich, setBereich] = useState<BereichId>(istAdmin ? 'branding' : 'gaeste');

  if (!loading && !istTeam) {
    return (
      <AppShell>
        <div className="page">
          <div className="empty">{t('settings.teamOnly')}</div>
        </div>
      </AppShell>
    );
  }

  const gewaehlt = sichtbar.some((eintrag) => eintrag.id === bereich)
    ? bereich
    : (sichtbar[0]?.id ?? 'gaeste');

  return (
    <AppShell>
      <div className="page settingspage">
        <SectionNav
          title={t('settings.title')}
          items={sichtbar}
          active={gewaehlt}
          onSelect={(id) => setBereich(id as BereichId)}
        />

        <div className="settingspage__body">
          {/* Die Überschrift steht hier, nicht in den Panels: Bis Phase 23
              trugen nur „Gäste" und „Benutzer" eine – auf allen anderen Seiten
              begann der Text ohne Ansage, und auf dem Handy, wo das Menü
              zugeklappt ist, stand nirgends, wo man gerade war. */}
          <h1 className="page__title settingspage__heading">
            {sichtbar.find((eintrag) => eintrag.id === gewaehlt)?.label ?? t('settings.title')}
          </h1>

          {gewaehlt === 'gaeste' ? <GuestsPanel /> : null}
          {gewaehlt === 'benutzer' ? <UsersPanel /> : null}
          {gewaehlt === 'felder' ? <FieldsPanel /> : null}
          {gewaehlt === 'projekte' ? <ProjectsPanel /> : null}
          {gewaehlt === 'ki' ? <AiPanel /> : null}
          {gewaehlt === 'branding' ? <BrandingPanel /> : null}
          {gewaehlt === 'auth' ? <AuthPanel /> : null}
          {gewaehlt === 'api' ? <ApiAccessPanel /> : null}
          {gewaehlt === 'mail' ? <SmtpPanel /> : null}
          {gewaehlt === 'transcode' ? <TranscodePanel /> : null}
          {gewaehlt === 'speicher' ? <StoragePanel /> : null}
          {gewaehlt === 'sicherung' ? <BackupPanel /> : null}
        </div>
      </div>
    </AppShell>
  );
}
