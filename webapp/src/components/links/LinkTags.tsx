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
      {error ? <p class="links-error">{error}</p> : null}
      <div class="flex gap-2">
        <input
          class="input"
          placeholder="New tag name"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-primary small" onClick={create}>
          Add
        </button>
        <button
          class="btn btn-secondary small"
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
            class="card flex items-center gap-2 px-2 py-1 text-sm"
          >
            <span class="font-medium">#{tag.name}</span>
            {tag.bookmark_count !== undefined ? (
              <span class="links-hint">{tag.bookmark_count}</span>
            ) : null}
            <span class="flex-1" />
            <button
              class="btn btn-secondary small"
              onClick={() => setRenaming({ id: tag.id, name: tag.name })}
            >
              Rename
            </button>
            <button
              class="btn btn-danger small"
              onClick={() => remove(tag.id, tag.name)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {tags.length === 0 && !tagsQuery.isLoading ? (
        <p class="links-hint">No tags yet.</p>
      ) : null}

      {renaming ? (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRenaming(null)}>
          <div class="card links-modal" onClick={(e) => e.stopPropagation()}>
            <h2 class="mb-2 font-semibold">Rename tag</h2>
            <input
              class="input w-full"
              value={renaming.name}
              onInput={(e) =>
                setRenaming({ ...renaming, name: (e.target as HTMLInputElement).value })
              }
            />
            <div class="mt-3 flex justify-end gap-2">
              <button class="btn btn-secondary small" onClick={() => setRenaming(null)}>Cancel</button>
              <button class="btn btn-primary small" onClick={rename}>Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {mergeOpen ? (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMergeOpen(false)}>
          <div class="card links-modal" onClick={(e) => e.stopPropagation()}>
            <h2 class="mb-2 font-semibold">Merge tags</h2>
            <p class="mb-2 links-hint">
              Move all bookmarks from the source tag onto the target (created if missing).
            </p>
            <input
              class="mb-2 input w-full"
              placeholder="From (source)"
              value={mergeFrom}
              list="links-tags-list"
              onInput={(e) => setMergeFrom((e.target as HTMLInputElement).value)}
            />
            <input
              class="input w-full"
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
              <button class="btn btn-secondary small" onClick={() => setMergeOpen(false)}>Cancel</button>
              <button class="btn btn-primary small" onClick={merge}>Merge</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
