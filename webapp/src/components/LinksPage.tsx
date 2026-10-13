import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Clock, Folder, Pencil, Plus, Settings, SlidersHorizontal, X } from 'lucide-preact';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  archiveLinkBookmark,
  deleteLinkBookmark,
  getLinkProfile,
  listLinkBookmarks,
  listLinkBundles,
  listLinkTags,
  updateLinkBookmark,
  updateLinkProfile,
  type LinkBookmark,
} from '@/lib/api/links';
import { t } from '@/lib/i18n';
import { LinkBulkBar } from '@/components/links/LinkBulkBar';
import { LinkBundles } from '@/components/links/LinkBundles';
import { LinkCard } from '@/components/links/LinkCard';
import { LinkDetails } from '@/components/links/LinkDetails';
import { LinkModal } from '@/components/links/LinkModal';
import { LinkSettings } from '@/components/links/LinkSettings';
import { LinkTags } from '@/components/links/LinkTags';
import { LinkBackup } from '@/components/links/LinkBackup';
import './links/links.css';

type LinksTab = 'bookmarks' | 'tags' | 'bundles' | 'settings' | 'backup';
type BookmarkView = 'all' | 'active' | 'archived' | 'unread' | 'shared' | 'untagged';

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Added ↓' },
  { value: 'added_asc', label: 'Added ↑' },
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'modified_desc', label: 'Modified ↓' },
  { value: 'modified_asc', label: 'Modified ↑' },
];

// Bookmark list views. `all` spans archived + active; `active` is the
// linkding default (unarchived only).
const VIEWS: readonly BookmarkView[] = ['active', 'archived', 'unread', 'shared', 'untagged', 'all'];
const VIEW_LABELS: Record<BookmarkView, string> = {
  all: 'All',
  active: 'Active',
  archived: 'Archived',
  unread: 'Unread',
  shared: 'Shared',
  untagged: 'Untagged',
};

// Append `#tag` to the search box, mirroring linkding's tag-cloud links which
// add the tag to the current query.
function addTagToQuery(raw: string, tagName: string): string {
  const trimmed = raw.trim();
  return trimmed ? `${trimmed} #${tagName}` : `#${tagName}`;
}

// Remove the `#tag` token from the search box (linkding's selected-tag links).
function removeTagFromQuery(raw: string, tagName: string): string {
  const lowered = tagName.toLowerCase();
  return raw
    .split(/\s+/)
    .filter((part) => {
      if (!part) return false;
      const m = /^#(.+)$/.exec(part);
      return !m || m[1].toLowerCase() !== lowered;
    })
    .join(' ');
}

// If the search box holds something that looks like a bare URL, prefill the
// "Add bookmark" form with it so saving a link is a copy-paste away.
function extractUrlCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return '';
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function readDefaultOrder(profile: Record<string, unknown> | undefined): string {
  try {
    const raw = profile?.['search_preferences'];
    if (typeof raw === 'string' && raw) {
      const parsed = JSON.parse(raw) as { order?: unknown };
      if (typeof parsed.order === 'string') return parsed.order;
    }
  } catch {
    // Ignore malformed saved preferences.
  }
  return '';
}

export default function LinksPage({
  linksFetch,
  onNotify,
}: {
  linksFetch: AuthedFetch;
  onNotify: (type: 'success' | 'error', text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<LinksTab>('bookmarks');
  const [view, setView] = useState<BookmarkView>('active');
  const [q, setQ] = useState('');
  const [bundle, setBundle] = useState('');
  const [order, setOrder] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [prefillUrl, setPrefillUrl] = useState('');
  const [draftOrder, setDraftOrder] = useState('');
  const [draftShared, setDraftShared] = useState<'off' | 'shared' | 'unshared'>('off');
  const [draftUnread, setDraftUnread] = useState<'off' | 'unread' | 'read'>('off');
  const [bulkMode, setBulkMode] = useState(false);
  const debouncedQ = useDebounced(q, 300);
  const [absoluteTime, setAbsoluteTime] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LinkBookmark | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const urlStateReady = useRef(false);

  // Restore the active filters from the query string on mount, so reloading or
  // sharing a filtered URL reproduces the exact same list (linkding behavior).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawView = params.get('view');
    if (rawView === 'all' || rawView === 'active' || rawView === 'archived' || rawView === 'unread' || rawView === 'shared' || rawView === 'untagged') {
      setView(rawView);
    }
    const rawSort = params.get('sort');
    if (rawSort) setOrder(rawSort);
    const rawQuery = params.get('q');
    if (rawQuery) setQ(rawQuery);
    const rawBundle = params.get('bundle');
    if (rawBundle) setBundle(rawBundle);
    urlStateReady.current = true;
  }, []);

  // Mirror the filters back into the URL so the view is shareable and
  // survives reloads. replaceState keeps this from spamming browser history.
  useEffect(() => {
    if (!urlStateReady.current) return;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (order) params.set('sort', order);
    if (view !== 'active') params.set('view', view);
    if (bundle) params.set('bundle', bundle);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [q, order, view, bundle]);

  useEffect(() => {
    setSelected([]);
  }, [view, tab]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === '/' && !typing && tab === 'bookmarks') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab]);

  // Dismiss the view/search dropdowns on outside click or Escape.
  useEffect(() => {
    if (!viewMenuOpen && !optionsOpen) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.links-views-wrap')) return;
      if (target?.closest('.links-options-wrap')) return;
      setViewMenuOpen(false);
      setOptionsOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setViewMenuOpen(false);
        setOptionsOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [viewMenuOpen, optionsOpen]);

  const profileQuery = useQuery({
    queryKey: ['links-profile'],
    queryFn: () => getLinkProfile(linksFetch),
    retry: false,
  });
  const tagsQuery = useQuery({
    queryKey: ['links-tags'],
    queryFn: () => listLinkTags(linksFetch),
    retry: false,
  });
  const bundlesQuery = useQuery({
    queryKey: ['links-bundles'],
    queryFn: () => listLinkBundles(linksFetch),
    retry: false,
  });

  useEffect(() => {
    if (profileQuery.data) setOrder((cur) => cur || readDefaultOrder(profileQuery.data));
  }, [profileQuery.data]);

  // Page size comes from the Links settings ("Items per page", 1-100); clamp
  // defensively so the backend's limit<=100 cap is always respected.
  const pageSize = Math.min(Math.max(Number(profileQuery.data?.['items_per_page'] ?? 30) || 30, 1), 100);

  // Paginated "load more" list, matching linkding's paged bookmark list. The page
  // size is the "Items per page" preference (backend caps limit at 100);
  // hasNextPage/fetchNextPage drives the Load-more button so long collections
  // stay browsable without a full rebuild.
  const listQuery = useInfiniteQuery({
    queryKey: ['links-bookmarks', view, debouncedQ, bundle, order, pageSize],
    queryFn: ({ pageParam }) =>
      listLinkBookmarks(linksFetch, {
        q: debouncedQ || undefined,
        bundle: bundle || undefined,
        archived: view === 'archived' ? true : view === 'all' ? 'all' : undefined,
        unread: view === 'unread' || undefined,
        shared: view === 'shared' || undefined,
        untagged: view === 'untagged' || undefined,
        order: order || undefined,
        limit: pageSize,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined;
      try {
        const nextOffset = new URL(lastPage.next, 'http://localhost').searchParams.get('offset');
        return nextOffset ? Number(nextOffset) : undefined;
      } catch {
        return undefined;
      }
    },
    retry: false,
    enabled: tab === 'bookmarks',
  });

  const totalCount = listQuery.data?.pages[0]?.count ?? 0;
  const prefs = {
    showFavicon: Number(profileQuery.data?.['enable_favicons'] ?? 1) === 1,
    showDisplayUrl: Number(profileQuery.data?.['display_url'] ?? 1) === 1,
    permanentNotes: Number(profileQuery.data?.['permanent_notes'] ?? 0) === 1,
    absoluteTime: absoluteTime || String(profileQuery.data?.['bookmark_date_display'] ?? '') === 'absolute',
    linkTarget: String(profileQuery.data?.['bookmark_link_target'] ?? '_blank'),
  };

  const results = useMemo(() => {
    // unread/shared/untagged/all filtering happens server-side; pages arrive
    // already filtered.
    return (listQuery.data?.pages ?? []).flatMap((p) => p.results);
  }, [listQuery.data]);

  const hasActiveFilter = Boolean(debouncedQ || bundle) || (view !== 'active' && view !== 'all') || Boolean(order);

  const tags = tagsQuery.data ?? [];
  const bundles = bundlesQuery.data ?? [];

  // Bookmark backing the read-only "View" details dialog.
  const detailBookmark = detailId ? results.find((b) => b.id === detailId) ?? null : null;

  // Tag names currently active in the search box (e.g. "#foo #bar"), read live
  // from the input so the cloud highlights instantly. Mirrors linkding's
  // selected-tag state.
  const activeTagNames = useMemo(() => {
    const active = new Set<string>();
    const re = /#([^\s"]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q)) !== null) {
      // Drop trailing punctuation so "#reading," still matches tag `reading`.
      active.add(m[1].toLowerCase().replace(/[.,;:!?)\]]+$/, ''));
    }
    return active;
  }, [q]);

  // linkding-style tag cloud model: selected tags first, the rest grouped
  // alphabetically by first character for the group-initial highlight.
  const tagGroups = useMemo(() => {
    const sorted = [...tags].sort((a, b) =>
      a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0,
    );
    const selected = sorted.filter((t) => activeTagNames.has(t.name.toLowerCase()));
    const rest = sorted.filter((t) => !activeTagNames.has(t.name.toLowerCase()));
    const groups: Array<{ key: string; tags: typeof tags }> = [];
    for (const t of rest) {
      const ch = (t.name[0] ?? '#').toLowerCase();
      const last = groups[groups.length - 1];
      if (last && last.key === ch) last.tags.push(t);
      else groups.push({ key: ch, tags: [t] });
    }
    return { selected, groups };
  }, [tags, activeTagNames]);

  function clearFilters() {
    setQ('');
    setBundle('');
    setView('active');
    setOrder('');
  }

  function openOptions() {
    setDraftOrder(order);
    setDraftShared(view === 'shared' ? 'shared' : 'off');
    setDraftUnread(view === 'unread' ? 'unread' : 'off');
    setOptionsOpen((v) => !v);
  }

  function applyOptions() {
    setOrder(draftOrder);
    if (draftShared === 'shared') setView('shared');
    else if (draftUnread === 'unread') setView('unread');
    else if (view === 'shared' || view === 'unread') setView('active');
    setOptionsOpen(false);
  }

  async function saveOptionsDefault() {
    try {
      await updateLinkProfile(linksFetch, {
        search_preferences: JSON.stringify({ order: draftOrder }),
      });
      queryClient.invalidateQueries({ queryKey: ['links-profile'] });
      onNotify('success', 'Default search options saved.');
    } catch (e) {
      onNotify('error', e instanceof Error ? e.message : 'Save failed.');
    }
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function mutate(id: string, payload: Record<string, unknown>) {
    try {
      await updateLinkBookmark(linksFetch, id, payload);
      queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
    } catch (e) {
      onNotify('error', e instanceof Error ? e.message : 'Update failed.');
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this bookmark?')) return;
    try {
      await deleteLinkBookmark(linksFetch, id);
      queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
    } catch (e) {
      onNotify('error', e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  // Open the create form, pre-filling the URL when the search box holds one.
  function openAddBookmark() {
    // Use the live input, not the debounced value, so a fast type-then-click
    // still prefills the URL.
    setPrefillUrl(extractUrlCandidate(q));
    setEditing(null);
    setModalOpen(true);
  }

  const tabs: Array<[LinksTab, string]> = [
    ['bookmarks', t('nav_links_bookmarks')],
    ['tags', t('nav_links_tags')],
    ['bundles', t('nav_links_bundles')],
    ['settings', t('nav_links_settings')],
    ['backup', t('nav_links_backup')],
  ];

  return (
    <div class="space-y-3">
      <nav class="settings-category-tabs" aria-label={t('nav_links')}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            class={`settings-category-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'bookmarks' ? (
        <div class="links-panels">
          <div class="links-main">
          <div class="links-searchrow" style={{ marginTop: 8 }}>
            <div class="search-input-wrap links-search-wrap">
              <input
                ref={searchRef}
                class="search-input links-search"
                placeholder='Search for words or #tags'
                value={q}
                onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
              />
              {q ? (
                <button
                  type="button"
                  class="search-clear-btn"
                  title="Clear search"
                  aria-label="Clear search"
                  onClick={() => {
                    setQ('');
                    searchRef.current?.focus();
                  }}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
            <div class="links-options-wrap">
              <button
                type="button"
                class="btn btn-secondary small list-icon-btn"
                title="Search options"
                aria-label="Search options"
                onClick={openOptions}
              >
                <SlidersHorizontal size={14} class="btn-icon" />
              </button>
              {optionsOpen ? (
                <div class="links-options">
                  <h4>Sort by</h4>
                  <label class="field" style={{ marginBottom: 8 }}>
                    <select
                      class="input"
                      value={draftOrder}
                      onChange={(e) => setDraftOrder((e.currentTarget as HTMLSelectElement).value)}
                    >
                      {SORT_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                  <h4>Shared filter</h4>
                  <div class="links-radio-row" style={{ marginBottom: 8 }}>
                    {(['off', 'shared', 'unshared'] as const).map((v) => (
                      <label key={v}>
                        <input
                          type="radio"
                          name="links-shared"
                          checked={draftShared === v}
                          onChange={() => setDraftShared(v)}
                        />
                        {v === 'off' ? 'Off' : v === 'shared' ? 'Shared' : 'Unshared'}
                      </label>
                    ))}
                  </div>
                  <h4>Unread filter</h4>
                  <div class="links-radio-row" style={{ marginBottom: 8 }}>
                    {(['off', 'unread', 'read'] as const).map((v) => (
                      <label key={v}>
                        <input
                          type="radio"
                          name="links-unread"
                          checked={draftUnread === v}
                          onChange={() => setDraftUnread(v)}
                        />
                        {v === 'off' ? 'Off' : v === 'unread' ? 'Unread' : 'Read'}
                      </label>
                    ))}
                  </div>
                  <div class="flex gap-2">
                    <button type="button" class="btn btn-primary small" onClick={applyOptions}>
                      Apply
                    </button>
                    <button type="button" class="btn btn-secondary small" onClick={saveOptionsDefault}>
                      Save as default
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              class={`btn btn-secondary small list-icon-btn ${bulkMode ? 'active' : ''}`}
              title="Bulk edit"
              aria-label="Bulk edit"
              onClick={() => {
                setBulkMode((v) => !v);
                setSelected([]);
              }}
            >
              <Pencil size={14} class="btn-icon" />
            </button>
            <button
              type="button"
              class={`btn btn-secondary small list-icon-btn ${absoluteTime ? 'active' : ''}`}
              title="Toggle absolute time"
              aria-label="Toggle absolute time"
              onClick={() => setAbsoluteTime((v) => !v)}
            >
              <Clock size={14} class="btn-icon" />
            </button>
          </div>

          {/* View switcher + result count + Add sit below the search row. */}
          <div class="links-viewbar">
            <div class="links-views-wrap">
              <button
                type="button"
                class={`btn btn-secondary small links-view-toggle ${view !== 'active' ? 'active' : ''}`}
                onClick={() => setViewMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={viewMenuOpen}
              >
                <span class="links-view-toggle-label">{VIEW_LABELS[view]}</span>
                <ChevronDown size={13} class="btn-icon" />
              </button>
              {viewMenuOpen ? (
                <div class="links-view-menu" role="menu">
                  {VIEWS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="menuitem"
                      class={`tree-btn ${view === v ? 'active' : ''}`}
                      onClick={() => {
                        setView(v);
                        setViewMenuOpen(false);
                      }}
                    >
                      <span class="tree-label">{VIEW_LABELS[v]}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span class="links-count">
              {listQuery.isLoading
                ? 'Loading…'
                : totalCount > 0
                  ? `${totalCount} total${results.length < totalCount ? ` · ${results.length} shown` : ''}`
                  : ''}
            </span>
            <span class="spacer" />
            <button
              type="button"
              class="btn btn-primary small links-add-btn"
              title="Add bookmark"
              aria-label="Add bookmark"
              onClick={openAddBookmark}
            >
              <Plus size={14} class="btn-icon" />
            </button>
          </div>
          {bundle ? (
            <p class="links-hint" style={{ marginTop: 4 }}>
              Filtering by bundle #{bundle} —{' '}
              <button type="button" class="links-action" onClick={() => setBundle('')}>clear</button>
            </p>
          ) : null}

          {listQuery.isLoading ? <p class="links-hint">Loading…</p> : null}
              {listQuery.isError ? (
                <p class="links-error">Failed to load bookmarks.</p>
              ) : null}
              {bulkMode && results.length > 0 ? (
                <label class="flex items-center gap-2 text-sm" style={{ marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={results.length > 0 && results.every((b) => selected.includes(b.id))}
                    onChange={() => setSelected(
                      results.every((b) => selected.includes(b.id)) ? [] : results.map((b) => b.id),
                    )}
                  />
                  Select all ({results.length})
                </label>
              ) : null}
              <div>
                {results.map((b) => (
                  <LinkCard
                    key={b.id}
                    bookmark={b}
                    prefs={prefs}
                    bulkMode={bulkMode}
                    selected={selected.includes(b.id)}
                    onToggle={() => toggle(b.id)}
                    onTagClick={(tag) => setQ(addTagToQuery(q, tag))}
                    onView={() => setDetailId(b.id)}
                    onEdit={() => {
                      setEditing(b);
                      setModalOpen(true);
                    }}
                    onArchive={() => mutate(b.id, { is_archived: Number(b.is_archived) === 1 ? 0 : 1 })}
                    onDelete={() => remove(b.id)}
                    onToggleUnread={() => mutate(b.id, { unread: Number(b.unread) === 1 ? 0 : 1 })}
                    onToggleShared={() => mutate(b.id, { shared: Number(b.shared) === 1 ? 0 : 1 })}
                  />
                ))}
              </div>
              {!listQuery.isLoading && results.length === 0 ? (
                totalCount === 0 && !hasActiveFilter ? (
                  <div class="links-empty">
                    <p class="links-empty-title">You have no bookmarks yet</p>
                    <p class="links-empty-sub">
                      Get started by adding a bookmark, or import them from the
                      Backup tab (export/import a linkding-compatible JSON file).
                    </p>
                  </div>
                ) : (
                  <div class="links-empty">
                    <p class="links-empty-title">
                      {totalCount > 0 ? 'No bookmarks match the current filters' : 'No bookmarks found'}
                    </p>
                    <p class="links-empty-sub">
                      Try adjusting the search terms or filters.
                    </p>
                    {hasActiveFilter ? (
                      <button type="button" class="btn btn-secondary small" onClick={clearFilters}>
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
              {listQuery.hasNextPage ? (
                <div class="links-loadmore">
                  <button
                    type="button"
                    class="btn btn-secondary small"
                    disabled={listQuery.isFetchingNextPage}
                    onClick={() => void listQuery.fetchNextPage()}
                  >
                    {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                  <span class="links-hint">
                    Showing {results.length} of {totalCount}
                  </span>
                </div>
              ) : null}
              {bulkMode ? (
                <LinkBulkBar
                  linksFetch={linksFetch}
                  selected={selected}
                  onClear={() => setSelected([])}
                  onDone={() => {
                    setSelected([]);
                    queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
                  }}
                />
              ) : null}
            </div>

            <aside class="links-side-panel">
              <div class="links-side-stack">
              <div class="sidebar-block">
                <div class="sidebar-title-row">
                  <div class="sidebar-title">{t('nav_links_bundles')}</div>
                  <div class="folder-title-actions">
                    <button
                      type="button"
                      class="folder-add-btn"
                      title={t('nav_links_bundles')}
                      aria-label={t('nav_links_bundles')}
                      onClick={() => setTab('bundles')}
                    >
                      <Settings size={13} />
                    </button>
                  </div>
                </div>
                {bundles.length === 0 && !bundlesQuery.isLoading ? (
                  <p class="links-hint">No bundles yet.</p>
                ) : null}
                {bundles.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    class={`tree-btn ${bundle === b.id ? 'active' : ''}`}
                    onClick={() => setBundle(bundle === b.id ? '' : b.id)}
                  >
                    <Folder size={14} class="tree-icon" />
                    <span class="tree-label">{b.name}</span>
                  </button>
                ))}
              </div>
              <div class="sidebar-block">
                <div class="sidebar-title-row">
                  <div class="sidebar-title">{t('nav_links_tags')}</div>
                  <div class="folder-title-actions">
                    <button
                      type="button"
                      class="folder-add-btn"
                      title={t('nav_links_tags')}
                      aria-label={t('nav_links_tags')}
                      onClick={() => setTab('tags')}
                    >
                      <Settings size={13} />
                    </button>
                  </div>
                </div>
                {tags.length === 0 && !tagsQuery.isLoading ? (
                  <p class="links-hint">No tags yet.</p>
                ) : null}
                <div class="links-tag-cloud">
                  {tagGroups.selected.length > 0 ? (
                    <p class="links-tag-selected">
                      {tagGroups.selected.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          class="links-tag-active"
                          title={`Remove #${tag.name} from search`}
                          onClick={() => setQ(removeTagFromQuery(q, tag.name))}
                        >
                          -{tag.name}
                        </button>
                      ))}
                    </p>
                  ) : null}
                  <div class="links-tag-groups">
                    {tagGroups.groups.map((g) => (
                      <p key={g.key} class="links-tag-group">
                        {g.tags.map((tag, i) => (
                          <span key={tag.id}>
                            {i > 0 ? ' ' : null}
                            <button
                              type="button"
                              class="links-tag"
                              title={`Search #${tag.name}`}
                              onClick={() => setQ(addTagToQuery(q, tag.name))}
                            >
                              {i === 0 ? (
                                <>
                                  <span class="links-tag-initial">{tag.name.slice(0, 1)}</span>
                                  <span>{tag.name.slice(1)}</span>
                                </>
                              ) : (
                                tag.name
                              )}
                            </button>
                          </span>
                        ))}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
              </div>
            </aside>

          {modalOpen ? (
            <LinkModal
              linksFetch={linksFetch}
              initial={editing}
              prefillUrl={editing ? undefined : prefillUrl}
              tagOptions={tags.map((tag) => tag.name)}
              onClose={() => setModalOpen(false)}
              onSaved={() => {
                setModalOpen(false);
                setPrefillUrl('');
                queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
                queryClient.invalidateQueries({ queryKey: ['links-tags'] });
              }}
            />
          ) : null}
          {detailBookmark ? (
            <LinkDetails
              bookmark={detailBookmark}
              prefs={prefs}
              onClose={() => setDetailId(null)}
              onEdit={() => {
                setDetailId(null);
                setEditing(detailBookmark);
                setModalOpen(true);
              }}
              onDelete={() => {
                setDetailId(null);
                remove(detailBookmark.id);
              }}
              onToggleArchive={() =>
                mutate(detailBookmark.id, { is_archived: Number(detailBookmark.is_archived) === 1 ? 0 : 1 })
              }
              onToggleUnread={() => mutate(detailBookmark.id, { unread: Number(detailBookmark.unread) === 1 ? 0 : 1 })}
              onToggleShared={() => mutate(detailBookmark.id, { shared: Number(detailBookmark.shared) === 1 ? 0 : 1 })}
            />
          ) : null}
          </div>
      ) : null}

      {tab === 'tags' ? <LinkTags linksFetch={linksFetch} /> : null}
      {tab === 'bundles' ? (
        <LinkBundles
          linksFetch={linksFetch}
          onApply={(bundleId) => {
            setBundle(bundleId);
            setTab('bookmarks');
          }}
        />
      ) : null}
      {tab === 'settings' ? <LinkSettings linksFetch={linksFetch} /> : null}
      {tab === 'backup' ? <LinkBackup linksFetch={linksFetch} /> : null}
    </div>
  );
}
