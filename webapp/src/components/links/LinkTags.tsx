import { useState } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  createLinkTag,
  deleteLinkTag,
  listLinkTags,
  mergeLinkTags,
  renameLinkTag,
} from '@/lib/api/links';

export function LinkTags({ linksFetch }: { linksFetch: AuthedFetch }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeTo, setMergeTo] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const tagsQuery = useQuery({
    queryKey: ['links-tags'],
    queryFn: () => listLinkTags(linksFetch),
    retry: false,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['links-tags'] });
    queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
  }

  async function create() {
    if (!name.trim()) return;
    setError('');
    try {
      await createLinkTag(linksFetch, name.trim());
      setName('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed.');
    }
  }

  async function remove(id: string, tagName: string) {
    if (!confirm(`Delete tag "${tagName}"?`)) return;
    setError('');
    try {
      await deleteLinkTag(linksFetch, id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  async function rename() {
    if (!renaming || !renaming.name.trim()) return;
    setError('');
    try {
      await renameLinkTag(linksFetch, renaming.id, renaming.name.trim());
      setRenaming(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rename failed.');
    }
  }

  async function merge() {
    if (!mergeFrom.trim() || !mergeTo.trim()) {
      setError('Both source and target tags are required.');
      return;
    }
    setError('');
    try {
      await mergeLinkTags(linksFetch, mergeFrom.trim(), mergeTo.trim());
      setMergeFrom('');
      setMergeTo('');
      setMergeOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed.');
    }
  }

  const tags = tagsQuery.data ?? [];

  return (
    <div class="space-y-3">
      {error ? <p class="text-sm text-red-600">{error}</p> : null}
      <div class="flex gap-2">
        <input
          class="flex-1 rounded border px-2 py-1 dark:bg-gray-800"
          placeholder="New tag name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700" onClick={create}>
          Add
        </button>
        <button
          class="rounded border px-3 py-1 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
          onClick={() => setMergeOpen(true)}
        >
          Merge…
        </button>
      </div>
      {tagsQuery.isLoading ? <p class="text-sm">Loading…</p> : null}
      <ul class="space-y-1">
        {tags.map((tag) => (
          <li
            key={tag.id}
            class="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <span class="font-medium">#{tag.name}</span>
            {tag.bookmark_count !== undefined ? (
              <span class="text-xs text-gray-500">{tag.bookmark_count}</span>
            ) : null}
            <span class="flex-1" />
            <button
              class="rounded border px-2 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => setRenaming({ id: tag.id, name: tag.name })}
            >
              Rename
            </button>
            <button
              class="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              onClick={() => remove(tag.id, tag.name)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {tags.length === 0 && !tagsQuery.isLoading ? (
        <p class="text-sm text-gray-500">No tags yet.</p>
      ) : null}

      {renaming ? (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRenaming(null)}>
          <div class="w-full max-w-sm rounded bg-white p-4 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <h2 class="mb-2 font-semibold">Rename tag</h2>
            <input
              class="w-full rounded border px-2 py-1 dark:bg-gray-800"
              value={renaming.name}
              onInput={(e) =>
                setRenaming({ ...renaming, name: (e.target as HTMLInputElement).value })
              }
            />
            <div class="mt-3 flex justify-end gap-2">
              <button class="rounded border px-3 py-1 text-sm" onClick={() => setRenaming(null)}>Cancel</button>
              <button class="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={rename}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {mergeOpen ? (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMergeOpen(false)}>
          <div class="w-full max-w-sm rounded bg-white p-4 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <h2 class="mb-2 font-semibold">Merge tags</h2>
            <p class="mb-2 text-xs text-gray-500">
              Move all bookmarks from the source tag onto the target (created if missing).
            </p>
            <input
              class="mb-2 w-full rounded border px-2 py-1 dark:bg-gray-800"
              placeholder="From (source)"
              value={mergeFrom}
              list="links-tags-list"
              onInput={(e) => setMergeFrom((e.target as HTMLInputElement).value)}
            />
            <input
              class="w-full rounded border px-2 py-1 dark:bg-gray-800"
              placeholder="To (target)"
              value={mergeTo}
              list="links-tags-list"
              onInput={(e) => setMergeTo((e.target as HTMLInputElement).value)}
            />
            <datalist id="links-tags-list">
              {tags.map((tag) => (
                <option key={tag.id} value={tag.name} />
              ))}
            </datalist>
            <div class="mt-3 flex justify-end gap-2">
              <button class="rounded border px-3 py-1 text-sm" onClick={() => setMergeOpen(false)}>Cancel</button>
              <button class="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={merge}>Merge</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
