'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthPanel } from '@/components/settings/AuthPanel';
import { BrandingPanel } from '@/components/settings/BrandingPanel';
import { FieldsPanel } from '@/components/settings/FieldsPanel';
import { GuestsPanel } from '@/components/settings/GuestsPanel';
import { ProjectsPanel } from '@/components/settings/ProjectsPanel';
import { SmtpPanel } from '@/components/settings/SmtpPanel';
import { StoragePanel } from '@/components/settings/StoragePanel';
import { TranscodePanel } from '@/components/settings/TranscodePanel';
import { UsersPanel } from '@/components/settings/UsersPanel';
import { useSession } from '@/lib/session';

/**
 * Die Bereiche der Einstellungen (Phase 17). Senkrecht statt waagerecht, weil
 * die Liste weiter wächst – Reiter in einer Zeile wären längst umgebrochen.
 *
 * `team: true` heißt: auch Mitglieder dürfen hinein. Alles andere ist
 * Admin-Sache.
 */
const BEREICHE = [
  { id: 'gaeste', label: 'Gäste', team: true },
  { id: 'benutzer', label: 'Benutzer', team: false },
  { id: 'felder', label: 'Benutzerdefinierte Felder', team: false },
  { id: 'projekte', label: 'Projekte', team: false },
  { id: 'branding', label: 'Erscheinungsbild', team: false },
  { id: 'auth', label: 'Anmeldung', team: false },
  { id: 'mail', label: 'E-Mail-Versand', team: false },
  { id: 'transcode', label: 'Transcode', team: false },
  { id: 'speicher', label: 'Speicher', team: false },
] as const;

type BereichId = (typeof BEREICHE)[number]['id'];

/** Einstellungen des Workspace – Verwaltung und alles Workspace-Weite. */
export default function SettingsPage() {
  const { user, loading } = useSession();
  const istAdmin = user?.role === 'ADMIN';
  const istTeam = istAdmin || user?.role === 'MEMBER';
  const sichtbar = BEREICHE.filter((bereich) => (istAdmin ? true : bereich.team));
  // Mitglieder landen auf dem ersten Bereich, den sie sehen dürfen.
  const [bereich, setBereich] = useState<BereichId>(istAdmin ? 'branding' : 'gaeste');

  if (!loading && !istTeam) {
    return (
      <AppShell>
        <div className="page">
          <div className="empty">Diese Seite ist dem Team vorbehalten.</div>
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
        <nav className="settingsnav" aria-label="Einstellungen">
          <span className="settingsnav__title">Einstellungen</span>
          {sichtbar.map((eintrag) => (
            <button
              key={eintrag.id}
              type="button"
              className="settingsnav__item"
              data-active={gewaehlt === eintrag.id}
              onClick={() => setBereich(eintrag.id)}
            >
              {eintrag.label}
            </button>
          ))}
        </nav>

        <div className="settingspage__body">
          {gewaehlt === 'gaeste' ? <GuestsPanel /> : null}
          {gewaehlt === 'benutzer' ? <UsersPanel /> : null}
          {gewaehlt === 'felder' ? <FieldsPanel /> : null}
          {gewaehlt === 'projekte' ? <ProjectsPanel /> : null}
          {gewaehlt === 'branding' ? <BrandingPanel /> : null}
          {gewaehlt === 'auth' ? <AuthPanel /> : null}
          {gewaehlt === 'mail' ? <SmtpPanel /> : null}
          {gewaehlt === 'transcode' ? <TranscodePanel /> : null}
          {gewaehlt === 'speicher' ? <StoragePanel /> : null}
        </div>
      </div>
    </AppShell>
  );
}
