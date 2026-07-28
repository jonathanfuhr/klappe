'use client';

import type { UserDto, UserRole } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrator',
  MEMBER: 'Team-Mitglied',
  GUEST: 'Gast',
};

export default function UsersPage() {
  const { user: currentUser, loading: sessionLoading } = useSession();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!sessionLoading && currentUser && currentUser.role !== 'ADMIN') {
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
      <div className="page">
        <div className="page__header">
          <div>
            <h1 className="page__title">Benutzer</h1>
            <p className="page__subtitle">
              Team-Mitglieder sehen alle Projekte des Workspace. Gastzugänge über Freigaben folgen in
              Phase 6.
            </p>
          </div>
          <div className="shell__spacer" />
          <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
            Benutzer anlegen
          </button>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>E-Mail</th>
                <th>Rolle</th>
                <th>Status</th>
                <th>Angelegt</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td className="muted">{user.email}</td>
                  <td>
                    <select
                      className="select"
                      style={{ width: 'auto', padding: '4px 8px' }}
                      value={user.role}
                      onChange={(event) => {
                        void api
                          .updateUser(user.id, { role: event.target.value as UserRole })
                          .then(load)
                          .catch((updateError: unknown) =>
                            setError(
                              updateError instanceof Error ? updateError.message : 'Änderung fehlgeschlagen.',
                            ),
                          );
                      }}
                    >
                      {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {user.isActive ? (
                      <span className="badge badge--ready">aktiv</span>
                    ) : (
                      <span className="badge">gesperrt</span>
                    )}
                  </td>
                  <td className="muted">{formatDateTime(user.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => {
                        void api
                          .updateUser(user.id, { isActive: !user.isActive })
                          .then(load)
                          .catch((updateError: unknown) =>
                            setError(
                              updateError instanceof Error ? updateError.message : 'Änderung fehlgeschlagen.',
                            ),
                          );
                      }}
                    >
                      {user.isActive ? 'Sperren' : 'Entsperren'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating ? (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Benutzer anlegen" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.createUser({ name, email, password, role });
            await onCreated();
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="user-name">
            Name
          </label>
          <input
            id="user-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="user-email">
            E-Mail-Adresse
          </label>
          <input
            id="user-email"
            className="input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="user-password">
            Passwort (mindestens 10 Zeichen, Buchstaben und Ziffern)
          </label>
          <input
            id="user-password"
            className="input"
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="user-role">
            Rolle
          </label>
          <select
            id="user-role"
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            Anlegen
          </button>
        </div>
      </form>
    </Dialog>
  );
}
