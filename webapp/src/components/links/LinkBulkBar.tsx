import { useState } from 'preact/hooks';
import type { AuthedFetch } from '@/lib/api/shared';
import { bulkLinkBookmarks, type LinkBulkAction } from '@/lib/api/links';

const ACTIONS: Array<{ value: LinkBulkAction; label: string; needsTags: boolean }> = [
  { value: 'archive', label: 'Archive', needsTags: false },
  { value: 'unarchive', label: 'Unarchive', needsTags: false },
  { value: 'mark_read', label: 'Mark read', needsTags: false },
  { value: 'mark_unread', label: 'Mark unread', needsTags: false },
  { value: 'add_tags', label: 'Add tags', needsTags: true },
  { value: 'remove_tags', label: 'Remove tags', needsTags: true },
  { value: 'delete', label: 'Delete', needsTags: false },
];

export function LinkBulkBar({
  linksFetch,
  selected,
  onDone,
  onClear,
}: {
  linksFetch: AuthedFetch;
  selected: string[];
  onDone: () => void;
  onClear: () => void;
}) {
  const [action, setAction] = useState<LinkBulkAction>('archive');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (selected.length === 0) return null;
  const needsTags = ACTIONS.find((a) => a.value === action)?.needsTags ?? false;

  async function run() {
    if (action === 'delete' && !confirm(`Delete ${selected.length} bookmark(s)?`)) return;
    if (needsTags && !tags.trim()) {
      setError('tag_names is required for this action.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const tagNames = needsTags
        ? tags.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      await bulkLinkBookmarks(linksFetch, selected, action, tagNames);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="sticky bottom-2 flex flex-wrap items-center gap-2 rounded border border-blue-300 bg-blue-50 p-2 text-sm dark:border-blue-800 dark:bg-blue-950">
      <strong>{selected.length} selected</strong>
      <select
        class="rounded border px-1 py-0.5 dark:bg-gray-800"
        value={action}
        onChange={(e) => setAction((e.target as HTMLSelectElement).value as LinkBulkAction)}
      >
        {ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>
      {needsTags ? (
        <input
          class="rounded border px-2 py-0.5 dark:bg-gray-800"
          placeholder="tag1, tag2"
          value={tags}
          onInput={(e) => setTags((e.target as HTMLInputElement).value)}
        />
      ) : null}
      <button
        class="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-700"
        disabled={busy}
        onClick={run}
      >
        Apply
      </button>
      <button class="rounded border px-2 py-0.5 hover:bg-white dark:hover:bg-gray-800" onClick={onClear}>
        Clear
      </button>
      {error ? <span class="text-red-600">{error}</span> : null}
    </div>
  );
}
