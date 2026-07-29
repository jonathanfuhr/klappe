'use client';

import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthPanel } from '@/components/settings/AuthPanel';
import { BrandingPanel } from '@/components/settings/BrandingPanel';
import { FieldsPanel } from '@/components/settings/FieldsPanel';
import { SmtpPanel } from '@/components/settings/SmtpPanel';
import { useSession } from '@/lib/session';

const TABS = [
  { id: 'branding', label: 'Erscheinungsbild' },
  { id: 'auth', label: 'Anmeldung' },
  { id: 'mail', label: 'E-Mail-Versand' },
  { id: 'felder', label: 'Benutzerdefinierte Felder' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Einstellungen des Workspace – alles, was nur Administratoren angeht. */
export default function SettingsPage() {
  const { user, loading } = useSession();
  const [tab, setTab] = useState<TabId>('branding');

  if (!loading && user && user.role !== 'ADMIN') {
    return (
      <AppShell>
        <div className="page">
          <div className="empty">Diese Seite ist Administratoren vorbehalten.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="page__header">
          <div>
            <h1 className="page__title">Einstellungen</h1>
          </div>
        </div>

        <div className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="tabs__tab"
              data-active={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {tab === 'branding' ? <BrandingPanel /> : null}
        {tab === 'auth' ? <AuthPanel /> : null}
        {tab === 'mail' ? <SmtpPanel /> : null}
        {tab === 'felder' ? <FieldsPanel /> : null}
      </div>
    </AppShell>
  );
}
