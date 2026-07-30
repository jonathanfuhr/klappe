'use client';

import type {
  CustomerDto,
  FieldValueCountDto,
  ProjectDto,
  ProjectFieldDefDto,
  TagDto,
} from '@klappe/shared';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { TagChip } from '@/components/TagChip';
import { TagManager } from '@/components/TagManager';
import { Dialog } from '@/components/ui/Dialog';
import { FilterSelect } from '@/components/ui/FilterSelect';
import { Menu, MenuItem } from '@/components/ui/Menu';
import { DeleteProjectDialog, EditProjectDialog } from '@/components/ProjectDialogs';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

const BASIS_SORTS = [
  { id: 'updated', label: 'Zuletzt bearbeitet' },
  { id: 'created', label: 'Zuletzt angelegt' },
  { id: 'name', label: 'Name' },
  { id: 'customer', label: 'Kunde' },
];

export default function ProjectsPage() {
  const { user } = useSession();
  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [tagsEnabled, setTagsEnabled] = useState(true);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [fieldDefs, setFieldDefs] = useState<ProjectFieldDefDto[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, FieldValueCountDto[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [managingTags, setManagingTags] = useState(false);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatch, setTagMatch] = useState<'any' | 'all'>('any');
  const [sort, setSort] = useState('updated');
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  /** Je Feld-ID die gewählten Werte – die Dimensionen der Filterleiste. */
  const [selectedFieldValues, setSelectedFieldValues] = useState<Record<string, string[]>>({});
  /** `''` = nicht gruppieren, `customer` oder eine Feld-ID. */
  const [groupBy, setGroupBy] = useState('');

  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [deleting, setDeleting] = useState<ProjectDto | null>(null);
  const [renamingCustomer, setRenamingCustomer] = useState<string | null>(null);

  /**
   * Die tatsächlich wirksamen Feld-Filter. Ein Feld, dessen Filter nachträglich
   * abgeschaltet wurde (Phase 22), verschwindet aus der Leiste – ohne diese
   * Sieberei würde eine alte Auswahl weiter filtern, ohne dass irgendwo steht,
   * warum die Liste so kurz ist.
   */
  const aktiveFeldFilter = useMemo(
    () =>
      fieldDefs
        .filter((def) => def.filterable)
        .map((def) => ({ fieldId: def.id, values: selectedFieldValues[def.id] ?? [] }))
        .filter((eintrag) => eintrag.values.length > 0),
    [fieldDefs, selectedFieldValues],
  );

  // Gefiltert wird auf dem Server: Die Auswahl gehört in die Abfrage, nicht
  // in eine nachträgliche Sieberei über eine schon geholte Liste.
  const load = useCallback(async () => {
    try {
      setProjects(
        await api.listProjects({
          tagIds: selectedTags,
          tagMatch,
          // Gruppieren heißt: Die Sortierung stellt die Gruppen her.
          sort: groupBy === 'customer' ? 'customer' : groupBy ? `field:${groupBy}` : sort,
          customers: selectedCustomers,
          fieldFilters: aktiveFeldFilter,
        }),
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [selectedTags, tagMatch, sort, selectedCustomers, aktiveFeldFilter, groupBy]);

  /**
   * Die Filter-Dimensionen: Kunden, Felddefinitionen samt vorkommender Werte,
   * Schlagworte und der Schalter, ob es Schlagworte überhaupt gibt (Phase 16).
   */
  const loadMeta = useCallback(async () => {
    if (!isTeam) return;
    try {
      const [kunden, defs, einstellungen] = await Promise.all([
        api.listCustomers(),
        api.listProjectFields(),
        api.getProjectFieldSettings(),
      ]);
      setCustomers(kunden);
      setFieldDefs(defs);
      setTagsEnabled(einstellungen.tagsEnabled);
      if (einstellungen.tagsEnabled) {
        setTags(await api.listTags());
      } else {
        setTags([]);
        setSelectedTags([]);
      }
      const wertePaare = await Promise.all(
        defs.map(async (def) => [def.id, await api.listProjectFieldValues(def.id)] as const),
      );
      setFieldValues(Object.fromEntries(wertePaare));
    } catch {
      // Ohne Metadaten fehlt nur die Filterleiste – die Liste läuft weiter.
    }
  }, [isTeam]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const alles = useCallback(async () => {
    await Promise.all([load(), loadMeta()]);
  }, [load, loadMeta]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(term) ||
          (project.customer ?? '').toLowerCase().includes(term) ||
          (project.description ?? '').toLowerCase().includes(term) ||
          // Auch die benutzerdefinierten Felder – wer „24-117" sucht, meint
          // die Projektnummer.
          project.fields.some((feld) => feld.value.toLowerCase().includes(term)),
      )
    : projects;

  const gruppenLabel =
    groupBy === 'customer'
      ? 'Kunde'
      : (fieldDefs.find((def) => def.id === groupBy)?.name ?? 'Feld');

  /** Wert eines Projekts in der Gruppier-Dimension. */
  const gruppenWert = useCallback(
    (project: ProjectDto): string => {
      if (groupBy === 'customer') return project.customer?.trim() || `Ohne ${gruppenLabel}`;
      const feld = project.fields.find((eintrag) => eintrag.fieldId === groupBy);
      return feld?.value.trim() || `Ohne ${gruppenLabel}`;
    },
    [groupBy, gruppenLabel],
  );

  /**
   * Gruppen in der Reihenfolge, in der der Server sortiert hat – Projekte ohne
   * Wert stehen dadurch am Ende, nicht als erste namenlose Gruppe.
   */
  const gruppen = useMemo(() => {
    if (!groupBy) return null;
    const reihenfolge: string[] = [];
    const zuordnung = new Map<string, ProjectDto[]>();
    for (const project of visible) {
      const schluessel = gruppenWert(project);
      if (!zuordnung.has(schluessel)) {
        zuordnung.set(schluessel, []);
        reihenfolge.push(schluessel);
      }
      zuordnung.get(schluessel)?.push(project);
    }
    return reihenfolge.map((name) => ({ name, projekte: zuordnung.get(name) ?? [] }));
  }, [groupBy, visible, gruppenWert]);

  const filterAktiv =
    selectedTags.length > 0 || selectedCustomers.length > 0 || aktiveFeldFilter.length > 0;

  /** Felder, deren Wert laut Einstellung auf die Kachel gehört (Phase 22). */
  const kachelFeldIds = useMemo(
    () => new Set(fieldDefs.filter((def) => def.showOnTile).map((def) => def.id)),
    [fieldDefs],
  );

  const kachel = (project: ProjectDto) => (
    <Link key={project.id} href={`/projekte/${project.id}`} className="card tile">
      <div className="tile__body">
        {/* Der Kunde steht groß über dem Projektnamen (Phase 22) – wer viele
            Projekte hat, sucht zuerst nach dem Kunden, dann nach dem Titel. */}
        {project.customer ? <span className="tile__customer">{project.customer}</span> : null}
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
        {project.description ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {project.description}
          </span>
        ) : null}
        {project.fields.some((feld) => kachelFeldIds.has(feld.fieldId)) ? (
          <div className="tile__fields">
            {project.fields
              .filter((feld) => kachelFeldIds.has(feld.fieldId))
              .map((feld) => (
                <span key={feld.fieldId}>
                  <span className="faint">{feld.name}: </span>
                  {feld.value}
                </span>
              ))}
          </div>
        ) : null}
        {tagsEnabled && project.tags.length > 0 ? (
          <div className="tile__tags">
            {project.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} small />
            ))}
          </div>
        ) : null}
        <div className="tile__meta">
          {/* Archiviert sieht man der Kachel sonst nicht an – und es
              entscheidet, ob dort noch kommentiert werden kann (Phase 18). */}
          {project.archivedAt ? <span className="badge">archiviert</span> : null}
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
              {filterAktiv ? ' im Filter' : ' im Workspace'}
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
            {/* Jede Dimension ein Mehrfachauswahl-Filter – Kunde, jedes
                benutzerdefinierte Feld und (wenn eingeschaltet) die
                Schlagworte. Keine Sonderrolle mehr für einzelne (Phase 16). */}
            <FilterSelect
              label="Kunde"
              options={customers.map((kunde) => ({
                value: kunde.name,
                label: kunde.name,
                count: kunde.projectCount,
              }))}
              selected={selectedCustomers}
              onChange={setSelectedCustomers}
            />
            {/* Nur Felder, die laut Einstellung filterbar sind (Phase 22). */}
            {fieldDefs
              .filter((def) => def.filterable)
              .map((def) => (
                <FilterSelect
                  key={def.id}
                  label={def.name}
                  options={(fieldValues[def.id] ?? []).map((wert) => ({
                    value: wert.value,
                    label: wert.value,
                    count: wert.projectCount,
                  }))}
                  selected={selectedFieldValues[def.id] ?? []}
                  onChange={(values) =>
                    setSelectedFieldValues((current) => ({ ...current, [def.id]: values }))
                  }
                />
              ))}
            {tagsEnabled ? (
              <FilterSelect
                label="Schlagworte"
                options={tags.map((tag) => ({
                  value: tag.id,
                  label: tag.name,
                  count: tag.projectCount,
                  color: tag.color,
                }))}
                selected={selectedTags}
                onChange={setSelectedTags}
              />
            ) : null}

            {tagsEnabled && selectedTags.length > 1 ? (
              <label className="switch">
                <input
                  type="checkbox"
                  checked={tagMatch === 'all'}
                  onChange={(event) => setTagMatch(event.target.checked ? 'all' : 'any')}
                />
                alle gewählten
              </label>
            ) : null}

            {filterAktiv ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setSelectedTags([]);
                  setSelectedCustomers([]);
                  setSelectedFieldValues({});
                }}
              >
                Filter zurücksetzen
              </button>
            ) : null}

            <div className="shell__spacer" />

            <select
              className="select"
              style={{ width: 'auto' }}
              value={groupBy}
              onChange={(event) => setGroupBy(event.target.value)}
              aria-label="Gruppieren"
            >
              <option value="">Nicht gruppieren</option>
              <option value="customer">Nach Kunde</option>
              {/* Nur Felder, die laut Einstellung gruppierbar sind (Phase 22). */}
              {fieldDefs
                .filter((def) => def.groupable)
                .map((def) => (
                  <option key={def.id} value={def.id}>
                    Nach {def.name}
                  </option>
                ))}
            </select>

            {groupBy ? null : (
              <select
                className="select"
                style={{ width: 'auto' }}
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label="Sortierung"
              >
                {BASIS_SORTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
                {fieldDefs
                  .filter((def) => def.sortable)
                  .map((def) => (
                    <option key={def.id} value={`field:${def.id}`}>
                      {def.name}
                    </option>
                  ))}
              </select>
            )}

            {tagsEnabled ? (
              <button type="button" className="button" onClick={() => setManagingTags(true)}>
                Schlagworte
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="notice">{error}</div> : null}
        {loading ? <p className="muted">Wird geladen …</p> : null}

        {!loading && visible.length === 0 ? (
          <div className="empty">
            {projects.length === 0 && filterAktiv
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
                {isTeam && groupBy === 'customer' && !gruppe.name.startsWith('Ohne ') ? (
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
          customers={customers}
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
            await loadMeta();
            await load();
          }}
        />
      ) : null}
    </AppShell>
  );
}

function CreateProjectDialog({
  customers,
  onClose,
  onCreated,
}: {
  customers: CustomerDto[];
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
            list="project-customer-vorschlaege"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          />
          {/* Tippvorschläge aus den vorhandenen Kunden (Phase 16). */}
          <datalist id="project-customer-vorschlaege">
            {customers.map((eintrag) => (
              <option key={eintrag.name} value={eintrag.name} />
            ))}
          </datalist>
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
