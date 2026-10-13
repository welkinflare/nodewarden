import { useState } from 'preact/hooks';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  checkLinkBookmark,
  createLinkBookmark,
  updateLinkBookmark,
  type LinkBookmark,
} from '@/lib/api/links';

export interface LinkBookmarkForm {
  url: string;
  title: string;
  description: string;
  notes: string;
  tag_names: string;
  unread: boolean;
  is_archived: boolean;
  shared: boolean;
}

export function toLinkForm(b?: LinkBookmark | null): LinkBookmarkForm {
  return {
    url: b?.url ?? '',
    title: b?.title ?? '',
    description: b?.description ?? '',
    notes: b?.notes ?? '',
    tag_names: (b?.tag_names ?? []).join(', '),
    unread: Number(b?.unread ?? 0) === 1,
    is_archived: Number(b?.is_archived ?? 0) === 1,
    shared: Number(b?.shared ?? 0) === 1,
  };
}

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function LinkModal({
  linksFetch,
  initial,
  tagOptions,
  onClose,
  onSaved,
}: {
  linksFetch: AuthedFetch;
  initial: LinkBookmark | null;
  tagOptions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<LinkBookmarkForm>(() => toLinkForm(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rescrape, setRescrape] = useState('');

  function set<K extends keyof LinkBookmarkForm>(key: K, value: LinkBookmarkForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function doRescrape() {
    if (!form.url.trim()) return;
    setBusy(true);
    setError('');
    setRescrape('');
    try {
      const data = await checkLinkBookmark(linksFetch, form.url.trim());
      if (data.metadata?.title && !form.title) set('title', data.metadata.title);
      if (data.metadata?.description && !form.description) {
        set('description', data.metadata.description);
      }
      setRescrape('Metadata refreshed — review before saving.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rescrape failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form.url.trim()) {
      setError('URL is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        url: form.url.trim(),
        title: form.title,
        description: form.description,
        notes: form.notes,
        tag_names: splitTags(form.tag_names),
        unread: form.unread,
        is_archived: form.is_archived,
        shared: form.shared,
      };
      if (initial) {
        await updateLinkBookmark(linksFetch, initial.id, payload);
      } else {
        await createLinkBookmark(linksFetch, payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        class="card links-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 class="mb-2 text-lg font-semibold">{initial ? 'Edit bookmark' : 'Add bookmark'}</h2>
        {error ? <p class="links-error">{error}</p> : null}
        {rescrape ? <p class="links-ok">{rescrape}</p> : null}
        <label class="block text-sm">
          URL
          <input
            class="input w-full"
            value={form.url}
            onInput={(e) => set('url', (e.target as HTMLInputElement).value)}
            placeholder="https://example.com/article"
          />
        </label>
        <label class="mt-2 block text-sm">
          Title
          <input
            class="input w-full"
            value={form.title}
            onInput={(e) => set('title', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="mt-2 block text-sm">
          Description
          <textarea
            class="input w-full"
            rows={2}
            value={form.description}
            onInput={(e) => set('description', (e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <label class="mt-2 block text-sm">
          Notes (Markdown)
          <textarea
            class="input w-full"
            rows={3}
            value={form.notes}
            onInput={(e) => set('notes', (e.target as HTMLTextAreaElement).value)}
          />
        </label>
        <label class="mt-2 block text-sm">
          Tags (comma-separated)
          <input
            class="input w-full"
            value={form.tag_names}
            list="links-tag-options"
            onInput={(e) => set('tag_names', (e.target as HTMLInputElement).value)}
            placeholder="dev, reading"
          />
          <datalist id="links-tag-options">
            {tagOptions.map((tagName) => (
              <option key={tagName} value={tagName} />
            ))}
          </datalist>
        </label>
        <div class="mt-2 flex flex-wrap gap-3 text-sm">
          <label class="flex items-center gap-1">
            <input type="checkbox" checked={form.unread} onChange={(e) => set('unread', (e.target as HTMLInputElement).checked)} />
            Unread
          </label>
          <label class="flex items-center gap-1">
            <input type="checkbox" checked={form.is_archived} onChange={(e) => set('is_archived', (e.target as HTMLInputElement).checked)} />
            Archived
          </label>
          <label class="flex items-center gap-1">
            <input type="checkbox" checked={form.shared} onChange={(e) => set('shared', (e.target as HTMLInputElement).checked)} />
            Shared
          </label>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            class="btn btn-secondary small"
            disabled={busy}
            onClick={doRescrape}
          >
            Re-scrape
          </button>
          <span class="flex-1" />
          <button
            class="btn btn-secondary small"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            class="btn btn-primary small"
            disabled={busy}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
