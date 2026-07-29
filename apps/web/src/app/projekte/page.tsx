'use client';

import type { CustomerDto, ProjectDto, TagDto } from '@klappe/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { TagChip } from '@/components/TagChip';
import { TagManager } from '@/components/TagManager';
import { Dialog } from '@/components/ui/Dialog';
import { Menu, MenuItem } from '@/components/ui/Menu';
import { DeleteProjectDialog, EditProjectDialog } from '@/components/ProjectDialogs';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

type SortId = 'updated' | 'created' | 'name' | 'customer';

const SORTS: { id: SortId; label: string }[] = [
  { id: 'updated', label: 'Zuletzt bearbeitet' },
  { id: 'created', label: 'Zuletzt angelegt' },
  { id: 'name', label: 'Name' },
  { id: 'customer', label: 'Kunde' },
];

/** Sammelname für Projekte ohne Kundeneintrag – nur Anzeige, kein Wert. */
const OHNE_KUNDE = 'Ohne Kunde';

export default function ProjectsPage() {
  const { user } = useSession();
  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [managingTags, setManagingTags] = useState(false);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'any' | 'all'>('any');
  const [sort, setSort] = useState<SortId>('updated');
  const [customerFilter, setCustomerFilter] = useState('');
  const [grouped, setGrouped] = useState(false);

  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [deleting, setDeleting] = useState<ProjectDto | null>(null);
  const [renamingCustomer, setRenamingCustomer] = useState<string | null>(null);

  // Gefiltert wird auf dem Server: Die Auswahl gehört in die Abfrage, nicht
  // in eine nachträgliche Sieberei über eine schon geholte Liste.
  const load = useCallback(async () => {
    try {
      setProjects(
        await api.listProjects({
          tagIds: selectedTags,
          tagMatch,
          // Gruppiert wird nach Kunde – die Sortierung stellt die Gruppen her.
          sort: grouped ? 'customer' : sort,
          customer: customerFilter || undefined,
        }),
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [selectedTags, tagMatch, sort, customerFilter, grouped]);

  const loadTags = useCallback(async () => {
    if (!isTeam) return;
    try {
      setTags(await api.listTags());
    } catch {
      // Ohne Schlagworte bleibt die Liste einfach ungefiltert.
      setTags([]);
    }
  }, [isTeam]);

  const loadCustomers = useCallback(async () => {
    try {
      setCustomers(await api.listCustomers());
    } catch {
      // Ohne Kundenliste fehlt nur das Filter-Dropdown.
      setCustomers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const alles = useCallback(async () => {
    await Promise.all([load(), loadCustomers()]);
  }, [load, loadCustomers]);

  const toggleTag = (id: string) => {
    setSelectedTags((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  };

  const term = search.trim().toLowerCase();
  const visible = term
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(term) ||
          (project.customer ?? '').toLowerCase().includes(term) ||
          (project.description ?? '').toLowerCase().includes(term),
      )
    : projects;

  /**
   * Gruppen in der Reihenfolge, in der der Server sortiert hat – Projekte ohne
   * Kunden stehen dadurch am Ende, nicht als erste namenlose Gruppe.
   */
  const gruppen = useMemo(() => {
    if (!grouped) return null;
    const reihenfolge: string[] = [];
    const zuordnung = new Map<string, ProjectDto[]>();
    for (const project of visible) {
      const schluessel = project.customer?.trim() || OHNE_KUNDE;
      if (!zuordnung.has(schluessel)) {
        zuordnung.set(schluessel, []);
        reihenfolge.push(schluessel);
      }
      zuordnung.get(schluessel)?.push(project);
    }
    return reihenfolge.map((name) => ({ name, projekte: zuordnung.get(name) ?? [] }));
  }, [grouped, visible]);

  const kachel = (project: ProjectDto) => (
    <Link key={project.id} href={`/projekte/${project.id}`} className="card tile">
      <div className="tile__body">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <span className="tile__title" style={{ flex: 1 }}>
            {project.name}
          </span>
          {isTeam ? (
            <Menu label={`Aktionen für ${project.name}`}>
              <MenuItem onSelect={() => setEditing(project)}>Umbenennen …</MenuItem>
              <MenuItem danger onSelect={() => setDeleting(project)}>
                Löschen …
              </MenuItem>
            </Menu>
          ) : null}
        </div>
        {project.customer ? (
          <span className="faint" style={{ fontSize: 12 }}>
            {project.customer}
          </span>
        ) : null}
        {project.description ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {project.description}
          </span>
        ) : null}
        {project.tags.length > 0 ? (
          <div className="tile__tags">
            {project.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} small />
            ))}
          </div>
        ) : null}
        <div className="tile__meta">
          <span>
            {project.videoCount} {project.videoCount === 1 ? 'Video' : 'Videos'}
          </span>
          <span>·</span>
          <span>Geändert {formatRelative(project.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );

  return (
    <AppShell>
      <div className="page">
        <div className="page__header">
          <div>
            <h1 className="page__title">Projekte</h1>
            <p className="page__subtitle">
              {projects.length} {projects.length === 1 ? 'Projekt' : 'Projekte'}
              {selectedTags.length > 0 || customerFilter ? ' im Filter' : ' im Workspace'}
            </p>
          </div>
          <div className="shell__spacer" />
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Suchen …"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {isTeam ? (
            <button
              type="button"
              className="button button--primary"
              onClick={() => setCreating(true)}
            >
              Neues Projekt
            </button>
          ) : null}
        </div>

        {isTeam ? (
          <div className="filterbar">
            <div className="filterbar__tags">
              {tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  active={selectedTags.includes(tag.id)}
                  count={tag.projectCount}
                  onClick={() => toggleTag(tag.id)}
                />
              ))}
              {tags.length === 0 ? (
                <span className="faint" style={{ fontSize: 13 }}>
                  Noch keine Schlagworte.
                </span>
              ) : null}
            </div>

            <div className="shell__spacer" />

            {selectedTags.length > 1 ? (
              <label className="switch">
                <input
                  type="checkbox"
                  checked={tagMatch === 'all'}
                  onChange={(event) => setTagMatch(event.target.checked ? 'all' : 'any')}
                />
                alle gewählten
              </label>
            ) : null}

            {selectedTags.length > 0 || customerFilter ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setSelectedTags([]);
                  setCustomerFilter('');
                }}
              >
                Filter zurücksetzen
              </button>
            ) : null}

            {customers.length > 0 ? (
              <select
                className="select"
                style={{ width: 'auto' }}
                value={customerFilter}
                onChange={(event) => setCustomerFilter(event.target.value)}
                aria-label="Nach Kunde filtern"
              >
                <option value="">Alle Kunden</option>
                {customers.map((customer) => (
                  <option key={customer.name} value={customer.name}>
                    {customer.name} ({customer.projectCount})
                  </option>
                ))}
              </select>
            ) : null}

            <label className="switch">
              <input
                type="checkbox"
                checked={grouped}
                onChange={(event) => setGrouped(event.target.checked)}
              />
              nach Kunde gruppieren
            </label>

            {grouped ? null : (
              <select
                className="select"
                style={{ width: 'auto' }}
                value={sort}
                onChange={(event) => setSort(event.target.value as SortId)}
                aria-label="Sortierung"
              >
                {SORTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            )}

            <button type="button" className="button" onClick={() => setManagingTags(true)}>
              Schlagworte
            </button>
          </div>
        ) : null}

        {error ? <div className="notice">{error}</div> : null}
        {loading ? <p className="muted">Wird geladen …</p> : null}

        {!loading && visible.length === 0 ? (
          <div className="empty">
            {projects.length === 0 && (selectedTags.length > 0 || customerFilter)
              ? 'Kein Projekt passt zu diesem Filter.'
              : projects.length === 0
                ? 'Noch keine Projekte. Leg das erste an, um Videos hochzuladen.'
                : 'Kein Projekt passt zur Suche.'}
          </div>
        ) : null}

        {gruppen ? (
          gruppen.map((gruppe) => (
            <section key={gruppe.name}>
              <div className="grouphead">
                <span className="grouphead__title">{gruppe.name}</span>
                <span className="faint" style={{ fontSize: 13 }}>
                  {gruppe.projekte.length}
                </span>
                {isTeam && gruppe.name !== OHNE_KUNDE ? (
                  <Menu label={`Aktionen für Kunde ${gruppe.name}`}>
                    <MenuItem onSelect={() => setRenamingCustomer(gruppe.name)}>
                      Kunde umbenennen …
                    </MenuItem>
                  </Menu>
                ) : null}
              </div>
              <div className="grid">{gruppe.projekte.map(kachel)}</div>
            </section>
          ))
        ) : (
          <div className="grid">{visible.map(kachel)}</div>
        )}
      </div>

      {creating ? (
        <CreateProjectDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await alles();
          }}
        />
      ) : null}

      {editing ? (
        <EditProjectDialog
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await alles();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteProjectDialog
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await alles();
          }}
        />
      ) : null}

      {renamingCustomer ? (
        <RenameCustomerDialog
          customer={renamingCustomer}
          projectCount={customers.find((entry) => entry.name === renamingCustomer)?.projectCount ?? 0}
          onClose={() => setRenamingCustomer(null)}
          onSaved={async () => {
            setRenamingCustomer(null);
            await alles();
          }}
        />
      ) : null}

      {managingTags ? (
        <TagManager
          onClose={() => setManagingTags(false)}
          onChanged={async () => {
            await loadTags();
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Neues Projekt" onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.createProject({
              name,
              customer: customer || undefined,
              description: description || undefined,
            });
            await onCreated();
          } catch (createError) {
            setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="project-name">
            Name
          </label>
          <input
            id="project-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="project-customer">
            Kunde (optional)
          </label>
          <input
            id="project-customer"
            className="input"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
          <p className="hint">
            Steht im Download-Dateinamen und hilft beim Zuordnen hochgeladener Dateien.
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="project-description">
            Beschreibung (optional)
          </label>
          <textarea
            id="project-description"
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
            Anlegen
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Kunden umbenennen oder den Eintrag von allen Projekten entfernen. Wirkt über
 * alle Projekte mit diesem Namen – es gibt keine Kunden-Entität dahinter.
 */
function RenameCustomerDialog({
  customer,
  projectCount,
  onClose,
  onSaved,
}: {
  customer: string;
  projectCount: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(customer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const speichern = async (nach?: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.renameCustomer(customer, nach);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Kunde „${customer}“`} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await speichern(name.trim());
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="customer-name">
            Neuer Name
          </label>
          <input
            id="customer-name"
            className="input"
            required
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="hint">
            Wirkt auf {projectCount} {projectCount === 1 ? 'Projekt' : 'Projekte'} – auch in den
            Download-Dateinamen künftiger Fassungen.
          </p>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="dialog__actions">
          <button
            type="button"
            className="button button--danger"
            disabled={busy}
            onClick={() => void speichern(undefined)}
          >
            Kundeneintrag entfernen
          </button>
          <div className="shell__spacer" />
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || !name.trim() || name.trim() === customer}
          >
            Umbenennen
          </button>
        </div>
      </form>
    </Dialog>
  );
}
