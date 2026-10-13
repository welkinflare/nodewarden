import { useState } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  createLinkBundle,
  deleteLinkBundle,
  listLinkBundles,
  updateLinkBundle,
  type LinkBundle,
} from '@/lib/api/links';

const EMPTY = {
  name: '',
  search: '',
  any_tags: '',
  all_tags: '',
  excluded_tags: '',
  filter_unread: 0,
  filter_shared: 0,
  order: '',
};

export function LinkBundles({
  linksFetch,
  onApply,
}: {
  linksFetch: AuthedFetch;
  onApply: (bundleId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const bundlesQuery = useQuery({
    queryKey: ['links-bundles'],
    queryFn: () => listLinkBundles(linksFetch),
    retry: false,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['links-bundles'] });
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Name is required.');
      return;
    }
    setError('');
    try {
      if (editingId) {
        await updateLinkBundle(linksFetch, editingId, form);
      } else {
        await createLinkBundle(linksFetch, form);
      }
      setForm(EMPTY);
      setEditingId(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  async function remove(bundle: LinkBundle) {
    if (!confirm(`Delete bundle "${bundle.name}"?`)) return;
    try {
      await deleteLinkBundle(linksFetch, bundle.id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
    }
  }

  const bundles = bundlesQuery.data ?? [];

  return (
    <div class="space-y-3">
      {error ? <p class="text-sm text-red-600">{error}</p> : null}

      <div class="grid gap-2 rounded border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <h2 class="text-sm font-semibold">{editingId ? 'Edit bundle' : 'New bundle'}</h2>
        <input
          class="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          placeholder="Name"
          value={form.name}
          onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
        />
        <input
          class="rounded border px-2 py-1 text-sm dark:bg-gray-800"
          placeholder="Search text"
          value={form.search}
          onInput={(e) => setForm({ ...form, search: (e.target as HTMLInputElement).value })}
        />
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            class="rounded border px-2 py-1 text-sm dark:bg-gray-800"
            placeholder="any tags (comma)"
            value={form.any_tags}
            onInput={(e) => setForm({ ...form, any_tags: (e.target as HTMLInputElement).value })}
          />
          <input
            class="rounded border px-2 py-1 text-sm dark:bg-gray-800"
            placeholder="all tags (comma)"
            value={form.all_tags}
            onInput={(e) => setForm({ ...form, all_tags: (e.target as HTMLInputElement).value })}
          />
          <input
            class="rounded border px-2 py-1 text-sm dark:bg-gray-800"
            placeholder="excluded tags (comma)"
            value={form.excluded_tags}
            onInput={(e) => setForm({ ...form, excluded_tags: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="flex flex-wrap items-center gap-3 text-sm">
          <label class="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.filter_unread === 1}
              onChange={(e) =>
                setForm({ ...form, filter_unread: (e.target as HTMLInputElement).checked ? 1 : 0 })
              }
            />
            Only unread
          </label>
          <label class="flex items-center gap-1">
            <input
              type="checkbox"
              checked={form.filter_shared === 1}
              onChange={(e) =>
                setForm({ ...form, filter_shared: (e.target as HTMLInputElement).checked ? 1 : 0 })
              }
            />
            Only shared
          </label>
          <input
            class="rounded border px-2 py-1 text-sm dark:bg-gray-800"
            placeholder="order (e.g. title_asc)"
            value={form.order}
            onInput={(e) => setForm({ ...form, order: (e.target as HTMLInputElement).value })}
          />
          <span class="flex-1" />
          {editingId ? (
            <button
              class="rounded border px-3 py-1 text-sm"
              onClick={() => {
                setForm(EMPTY);
                setEditingId(null);
              }}
            >
              Cancel
            </button>
          ) : null}
          <button class="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={save}>
            {editingId ? 'Update' : 'Create'}
          </button>
        </div>
      </div>

      {bundlesQuery.isLoading ? <p class="text-sm">Loading…</p> : null}
      <ul class="space-y-1">
        {bundles.map((bundle) => (
          <li
            key={bundle.id}
            class="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-800 dark:bg-gray-900"
          >
            <span class="font-medium">{bundle.name}</span>
            {bundle.search ? <span class="text-xs text-gray-500">“{bundle.search}”</span> : null}
            <span class="flex-1" />
            <button class="rounded border px-2 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => onApply(bundle.id)}>
              Apply filter
            </button>
            <button
              class="rounded border px-2 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => {
                setEditingId(bundle.id);
                setForm({
                  name: bundle.name,
                  search: bundle.search ?? '',
                  any_tags: bundle.any_tags ?? '',
                  all_tags: bundle.all_tags ?? '',
                  excluded_tags: bundle.excluded_tags ?? '',
                  filter_unread: Number(bundle.filter_unread) === 1 ? 1 : 0,
                  filter_shared: Number(bundle.filter_shared) === 1 ? 1 : 0,
                  order: bundle.order ?? '',
                });
              }}
            >
              Edit
            </button>
            <button
              class="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600"
              onClick={() => remove(bundle)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {bundles.length === 0 && !bundlesQuery.isLoading ? (
        <p class="text-sm text-gray-500">No bundles yet.</p>
      ) : null}
    </div>
  );
}
