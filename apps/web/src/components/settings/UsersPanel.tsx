'use client';

import type { PasswordPolicy, UserDto, UserRole } from '@klappe/shared';
import { DEFAULT_PASSWORD_POLICY, describePasswordPolicy } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { type Translator, useT } from '@/lib/i18n';
import { useFormat } from '@/lib/format';

/** Die Reihenfolge im Auswahlfeld; die Beschriftung kommt aus dem Wörterbuch. */
const ROLLEN: UserRole[] = ['ADMIN', 'MEMBER', 'GUEST'];

function rollenName(rolle: UserRole, t: Translator): string {
  if (rolle === 'ADMIN') return t('users.roleAdmin');
  if (rolle === 'MEMBER') return t('users.roleMember');
  return t('users.roleGuest');
}

export function UsersPanel() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api.listUsers());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div>
        <div className="page__header">
          <div>
            <p className="page__subtitle" style={{ marginTop: 0 }}>
              {t('users.subtitleStart')} <strong>{t('settings.navGuests')}</strong>{' '}
              {t('users.subtitleEnd')}
            </p>
          </div>
          <div className="shell__spacer" />
          <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
            {t('users.create')}
          </button>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('common.email')}</th>
                <th>{t('users.colRole')}</th>
                <th>{t('users.colStatus')}</th>
                <th>{t('users.colCreated')}</th>
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
                        const rolle = event.target.value as UserRole;
                        // Ein Konto, das zum Gast wird, verschwindet aus dieser
                        // Liste – das soll niemanden erschrecken.
                        if (
                          rolle === 'GUEST' &&
                          !window.confirm(t('users.toGuestConfirm', { name: user.name }))
                        ) {
                          return;
                        }
                        void api
                          .updateUser(user.id, { role: rolle })
                          .then(load)
                          .catch((updateError: unknown) =>
                            setError(
                              updateError instanceof Error
                                ? updateError.message
                                : t('common.changeFailed'),
                            ),
                          );
                      }}
                    >
                      {ROLLEN.map((role) => (
                        <option key={role} value={role}>
                          {rollenName(role, t)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {user.isActive ? (
                      <span className="badge badge--ready">{t('users.active')}</span>
                    ) : (
                      <span className="badge">{t('users.blocked')}</span>
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
                              updateError instanceof Error
                                ? updateError.message
                                : t('common.changeFailed'),
                            ),
                          );
                      }}
                    >
                      {user.isActive ? t('users.block') : t('users.unblock')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
    </>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Die geltenden Passwort-Regeln (Phase 24); bis zur Antwort der Vorgabewert. */
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  useEffect(() => {
    void api
      .loginMethods()
      .then((methoden) => setPolicy(methoden.passwordPolicy))
      .catch(() => {
        // Verbindlich prüft ohnehin der Server.
      });
  }, []);

  return (
    <Dialog title={t('users.create')} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.createUser({ name, email, password, role });
            await onCreated();
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : t('common.createFailed'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="user-name">
            {t('common.name')}
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
            {t('common.email')}
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
            {t('common.password')}
          </label>
          <input
            id="user-password"
            className="input"
            type="password"
            required
            minLength={policy.minLength}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {/* Die Regeln kommen aus den Einstellungen (Phase 24) – hier stand
              vorher eine feste Zahl, die eine geänderte Richtlinie sofort zur
              Lüge gemacht hätte. */}
          <p className="hint">
            {describePasswordPolicy(policy)
              .map((regel) => t(regel.key, regel.vars))
              .join(', ')}
            .
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="user-role">
            {t('users.colRole')}
          </label>
          <select
            id="user-role"
            className="select"
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
          >
            {ROLLEN.map((value) => (
              <option key={value} value={value}>
                {rollenName(value, t)}
              </option>
            ))}
          </select>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
