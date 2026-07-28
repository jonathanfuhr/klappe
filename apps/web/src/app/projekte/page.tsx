'use client';

import type { ProjectDto, TagDto } from '@klappe/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { TagChip } from '@/components/TagChip';
import { TagManager } from '@/components/TagManager';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

type SortId = 'updated' | 'created' | 'name';

const SORTS: { id: SortId; label: string }[] = [
  { id: 'updated', label: 'Zuletzt bearbeitet' },
  { id: 'created', label: 'Zuletzt angelegt' },
  { id: 'name', label: 'Name' },
];

export default function ProjectsPage() {
  const { user } = useSession();
  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [managingTags, setManagingTags] = useState(false);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'any' | 'all'>('any');
  const [sort, setSort] = useState<SortId>('updated');

  // Gefiltert wird auf dem Server: Die Auswahl gehört in die Abfrage, nicht
  // in eine nachträgliche Sieberei über eine schon geholte Liste.
  const load = useCallback(async () => {
    try {
      setProjects(await api.listProjects({ tagIds: selectedTags, tagMatch, sort }));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [selectedTags, tagMatch, sort]);

  const loadTags = useCallback(async () => {
    if (!isTeam) return;
    try {
      setTags(await api.listTags());
    } catch {
      // Ohne Schlagworte bleibt die Liste einfach ungefiltert.
      setTags([]);
    }
  }, [isTeam]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

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

  return (
    <AppShell>
      <div className="page">
        <div className="page__header">
          <div>
            <h1 className="page__title">Projekte</h1>
            <p className="page__subtitle">
              {projects.length} {projects.length === 1 ? 'Projekt' : 'Projekte'}
              {selectedTags.length > 0 ? ' im Filter' : ' im Workspace'}
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

            {selectedTags.length > 0 ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setSelectedTags([])}
              >
                Filter zurücksetzen
              </button>
            ) : null}

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

            <button type="button" className="button" onClick={() => setManagingTags(true)}>
              Schlagworte
            </button>
          </div>
        ) : null}

        {error ? <div className="notice">{error}</div> : null}
        {loading ? <p className="muted">Wird geladen …</p> : null}

        {!loading && visible.length === 0 ? (
          <div className="empty">
            {projects.length === 0 && selectedTags.length > 0
              ? 'Kein Projekt trägt diese Schlagworte.'
              : projects.length === 0
                ? 'Noch keine Projekte. Leg das erste an, um Videos hochzuladen.'
                : 'Kein Projekt passt zur Suche.'}
          </div>
        ) : null}

        <div className="grid">
          {visible.map((project) => (
            <Link key={project.id} href={`/projekte/${project.id}`} className="card tile">
              <div className="tile__body">
                <span className="tile__title">{project.name}</span>
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
          ))}
        </div>
      </div>

      {creating ? (
        <CreateProjectDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await load();
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
