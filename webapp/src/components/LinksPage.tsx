import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, SlidersHorizontal } from 'lucide-preact';
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
import { LinkModal } from '@/components/links/LinkModal';
import { LinkSettings } from '@/components/links/LinkSettings';
import { LinkTags } from '@/components/links/LinkTags';
import { LinkBackup } from '@/components/links/LinkBackup';
import './links/links.css';

type LinksTab = 'bookmarks' | 'tags' | 'bundles' | 'settings' | 'backup';
type BookmarkView = 'all' | 'archived' | 'unread' | 'shared';

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Added ↓' },
  { value: 'added_asc', label: 'Added ↑' },
  { value: 'title_asc', label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'modified_desc', label: 'Modified ↓' },
];

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
  const [view, setView] = useState<BookmarkView>('all');
  const [q, setQ] = useState('');
  const [bundle, setBundle] = useState('');
  const [order, setOrder] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState('');
  const [draftShared, setDraftShared] = useState<'off' | 'shared' | 'unshared'>('off');
  const [draftUnread, setDraftUnread] = useState<'off' | 'unread' | 'read'>('off');
  const [bulkMode, setBulkMode] = useState(false);
  const debouncedQ = useDebounced(q, 300);
  const [absoluteTime, setAbsoluteTime] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LinkBookmark | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const listQuery = useQuery({
    queryKey: ['links-bookmarks', view, debouncedQ, bundle, order],
    queryFn: () =>
      listLinkBookmarks(linksFetch, {
        q: debouncedQ || undefined,
        bundle: bundle || undefined,
        archived: view === 'archived',
        order: order || undefined,
        limit: 100,
      }),
    retry: false,
    enabled: tab === 'bookmarks',
  });

  const prefs = {
    showFavicon: Number(profileQuery.data?.['enable_favicons'] ?? 1) === 1,
    showDisplayUrl: Number(profileQuery.data?.['display_url'] ?? 1) === 1,
    permanentNotes: Number(profileQuery.data?.['permanent_notes'] ?? 0) === 1,
    absoluteTime: absoluteTime || String(profileQuery.data?.['bookmark_date_display'] ?? '') === 'absolute',
    linkTarget: String(profileQuery.data?.['bookmark_link_target'] ?? '_blank'),
  };

  const results = useMemo(() => {
    const rows = listQuery.data?.results ?? [];
    if (view === 'unread') return rows.filter((b) => Number(b.unread) === 1);
    if (view === 'shared') return rows.filter((b) => Number(b.shared) === 1);
    return rows;
  }, [listQuery.data, view]);

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
    else if (view === 'shared' || view === 'unread') setView('all');
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

  const tags = tagsQuery.data ?? [];
  const bundles = bundlesQuery.data ?? [];

  const tabs: Array<[LinksTab, string]> = [
    ['bookmarks', t('nav_links_bookmarks')],
    ['tags', t('nav_links_tags')],
    ['bundles', t('nav_links_bundles')],
    ['settings', t('nav_links_settings')],
    ['backup', t('nav_links_backup')],
  ];

  return (
    <div class="space-y-3">
      <div class="links-views">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            class={`tree-btn ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span class="tree-label">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'bookmarks' ? (
        <div>
          <div class="links-head">
            <h2>Bookmarks</h2>
            <span class="links-count">{listQuery.data ? `${listQuery.data.count} total` : ''}</span>
            <span class="spacer" />
            <button
              type="button"
              class="btn btn-primary small"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add bookmark
            </button>
          </div>

          <div class="links-searchrow" style={{ marginTop: 8 }}>
            <input
              ref={searchRef}
              class="search-input"
              placeholder='Search for words or #tags'
              value={q}
              onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
            />
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
          </div>
          <p class="links-hint" style={{ marginTop: 4 }}>
            #tag "phrase" !excluded A OR B · press / to focus
            <label style={{ marginLeft: 12 }}>
              <input
                type="checkbox"
                checked={absoluteTime}
                onChange={(e) => setAbsoluteTime((e.currentTarget as HTMLInputElement).checked)}
              />{' '}
              Absolute time
            </label>
          </p>

          <div class="links-views" style={{ marginTop: 8 }}>
            {(['all', 'archived', 'unread', 'shared'] as const).map((v) => (
              <button
                key={v}
                type="button"
                class={`tree-btn ${view === v ? 'active' : ''}`}
                onClick={() => setView(v)}
              >
                <span class="tree-label" style={{ textTransform: 'capitalize' }}>{v}</span>
              </button>
            ))}
          </div>
          {bundle ? (
            <p class="links-hint" style={{ marginTop: 4 }}>
              Filtering by bundle #{bundle} —{' '}
              <button type="button" class="links-action" onClick={() => setBundle('')}>clear</button>
            </p>
          ) : null}

          <div class="links-layout" style={{ marginTop: 8 }}>
            <div>
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
                    onTagClick={(tag) => setQ(`#${tag}`)}
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
              {listQuery.data && results.length === 0 ? (
                <p class="links-hint">No bookmarks found.</p>
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

            <aside class="links-side-stack">
              <div class="sidebar-block">
                <div class="sidebar-title">Bundles</div>
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
                    <span class="tree-label">{b.name}</span>
                  </button>
                ))}
              </div>
              <div class="sidebar-block">
                <div class="sidebar-title">Tags</div>
                {tags.length === 0 && !tagsQuery.isLoading ? (
                  <p class="links-hint">No tags yet.</p>
                ) : null}
                <div class="links-cloud">
                  {tags.map((tag) => (
                    <span key={tag.id}>
                      <button type="button" onClick={() => setQ(`#${tag.name}`)}>
                        {tag.name}
                      </button>
                      {tag.bookmark_count !== undefined ? (
                        <span class="count"> {tag.bookmark_count}</span>
                      ) : null}
                      {' '}
                    </span>
                  ))}
                </div>
              </div>
            </aside>
          </div>

          {modalOpen ? (
            <LinkModal
              linksFetch={linksFetch}
              initial={editing}
              tagOptions={tags.map((tag) => tag.name)}
              onClose={() => setModalOpen(false)}
              onSaved={() => {
                setModalOpen(false);
                queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
                queryClient.invalidateQueries({ queryKey: ['links-tags'] });
              }}
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
