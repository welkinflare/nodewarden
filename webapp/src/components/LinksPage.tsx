import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  archiveLinkBookmark,
  deleteLinkBookmark,
  getLinkProfile,
  listLinkBookmarks,
  listLinkTags,
  updateLinkBookmark,
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

type LinksTab = 'bookmarks' | 'tags' | 'bundles' | 'settings' | 'backup';
type BookmarkView = 'all' | 'archived' | 'unread' | 'shared';

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
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

  const listQuery = useQuery({
    queryKey: ['links-bookmarks', view, debouncedQ, bundle],
    queryFn: () =>
      listLinkBookmarks(linksFetch, {
        q: debouncedQ || undefined,
        bundle: bundle || undefined,
        archived: view === 'archived',
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
    if (!confirm('Delete this bookmark?')) return;
    try {
      await deleteLinkBookmark(linksFetch, id);
      queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
    } catch (e) {
      onNotify('error', e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  const allIds = results.map((b) => b.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id));

  const tabs: Array<[LinksTab, string]> = [
    ['bookmarks', t('nav_links_bookmarks')],
    ['tags', t('nav_links_tags')],
    ['bundles', t('nav_links_bundles')],
    ['settings', t('nav_links_settings')],
    ['backup', t('nav_links_backup')],
  ];

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            class={`rounded px-2 py-1 text-sm ${
              tab === id
                ? 'bg-blue-600 text-white'
                : 'border hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'bookmarks' ? (
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            {(['all', 'archived', 'unread', 'shared'] as const).map((v) => (
              <button
                key={v}
                class={`rounded px-2 py-0.5 text-xs capitalize ${
                  view === v ? 'bg-blue-600 text-white' : 'border hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
            <span class="text-sm text-gray-500">
              {listQuery.data ? `${listQuery.data.count} total` : ''}
            </span>
            <span class="flex-1" />
            <label class="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={absoluteTime}
                onChange={(e) => setAbsoluteTime((e.target as HTMLInputElement).checked)}
              />
              Absolute time
            </label>
            <button
              class="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              Add
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <input
              ref={searchRef}
              class="min-w-0 flex-1 rounded border px-2 py-1 dark:bg-gray-800"
              placeholder='Search…  #tag  "phrase"  !excluded  A OR B   ( / to focus )'
              value={q}
              onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            />
            <input
              class="w-28 rounded border px-2 py-1 text-sm dark:bg-gray-800"
              placeholder="bundle id"
              title="Filter by bundle id"
              value={bundle}
              onInput={(e) => setBundle((e.target as HTMLInputElement).value)}
            />
          </div>

          {bundle ? (
            <p class="text-xs text-gray-500">
              Filtering by bundle #{bundle} —{' '}
              <button class="underline" onClick={() => setBundle('')}>clear</button>
            </p>
          ) : null}

          {listQuery.isLoading ? <p class="text-sm">Loading…</p> : null}
          {listQuery.isError ? (
            <p class="text-sm text-red-600">Failed to load bookmarks.</p>
          ) : null}

          {results.length > 0 ? (
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? [] : allIds)}
              />
              Select all ({results.length})
            </label>
          ) : null}

          <div class="space-y-2">
            {results.map((b) => (
              <LinkCard
                key={b.id}
                bookmark={b}
                prefs={prefs}
                selected={selected.includes(b.id)}
                onToggle={() => toggle(b.id)}
                onEdit={() => {
                  setEditing(b);
                  setModalOpen(true);
                }}
                onArchive={() => archiveLinkBookmark(linksFetch, b.id, Number(b.is_archived) !== 1).then(
                  () => queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] }),
                  (e: unknown) => onNotify('error', e instanceof Error ? e.message : 'Archive failed.'),
                )}
                onDelete={() => remove(b.id)}
                onToggleUnread={() => mutate(b.id, { unread: Number(b.unread) === 1 ? 0 : 1 })}
                onToggleShared={() => mutate(b.id, { shared: Number(b.shared) === 1 ? 0 : 1 })}
              />
            ))}
          </div>
          {listQuery.data && results.length === 0 ? (
            <p class="text-sm text-gray-500">No bookmarks found.</p>
          ) : null}

          <LinkBulkBar
            linksFetch={linksFetch}
            selected={selected}
            onClear={() => setSelected([])}
            onDone={() => {
              setSelected([]);
              queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
            }}
          />

          {modalOpen ? (
            <LinkModal
              linksFetch={linksFetch}
              initial={editing}
              tagOptions={(tagsQuery.data ?? []).map((tag) => tag.name)}
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
