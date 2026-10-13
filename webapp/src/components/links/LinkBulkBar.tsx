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
    <div class="card links-bulkbar">
      <strong>{selected.length} selected</strong>
      <select
        class="input"
        value={action}
        onChange={(e) => setAction((e.target as HTMLSelectElement).value as LinkBulkAction)}
      >
        {ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>
      {needsTags ? (
        <input
          class="input"
          placeholder="tag1, tag2"
          value={tags}
          onInput={(e) => setTags((e.target as HTMLInputElement).value)}
        />
      ) : null}
      <button
        class="btn btn-primary small"
        disabled={busy}
        onClick={run}
      >
        Apply
      </button>
      <button class="btn btn-secondary small" onClick={onClear}>
        Clear
      </button>
      {error ? <span class="links-error">{error}</span> : null}
    </div>
  );
}
