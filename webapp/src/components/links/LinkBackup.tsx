import { useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  confirmLinksImportHtml,
  confirmLinksImportJson,
  downloadLinksExport,
  previewLinksImportHtml,
  previewLinksImportJson,
  type LinkImportPreview,
} from '@/lib/api/links';

export function LinkBackup({ linksFetch }: { linksFetch: AuthedFetch }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [preview, setPreview] = useState<(LinkImportPreview & { kind: 'json' | 'html' }) | null>(null);
  const [pendingHtml, setPendingHtml] = useState<string | null>(null);
  const [pendingJson, setPendingJson] = useState<unknown>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
    queryClient.invalidateQueries({ queryKey: ['links-tags'] });
    queryClient.invalidateQueries({ queryKey: ['links-bundles'] });
  }

  async function onJsonFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setInfo('');
    setPreview(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;
      const result = await previewLinksImportJson(linksFetch, payload);
      setPendingJson(payload);
      setPendingHtml(null);
      setPreview({ ...result, kind: 'json' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    }
  }

  async function onHtmlFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setInfo('');
    setPreview(null);
    try {
      const html = await file.text();
      const result = await previewLinksImportHtml(linksFetch, html);
      setPendingHtml(html);
      setPendingJson(null);
      setPreview({ ...result, kind: 'html' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    }
  }

  async function confirm() {
    if (!preview || !ack) return;
    setBusy(true);
    setError('');
    try {
      const result =
        preview.kind === 'json'
          ? await confirmLinksImportJson(linksFetch, pendingJson)
          : await confirmLinksImportHtml(linksFetch, pendingHtml ?? '');
      setInfo(`Imported: ${result.add} added, ${result.update} updated, ${result.skip} skipped.`);
      setPreview(null);
      setPendingHtml(null);
      setPendingJson(null);
      setAck(false);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="space-y-3">
      {error ? <p class="text-sm text-red-600">{error}</p> : null}
      {info ? <p class="text-sm text-green-700">{info}</p> : null}

      <div class="rounded border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <h2 class="mb-2 font-medium">Export</h2>
        <div class="flex flex-wrap gap-2 text-sm">
          <button class="rounded border px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => downloadLinksExport('export.json')}>
            Download JSON backup
          </button>
          <button class="rounded border px-3 py-1 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => downloadLinksExport('export.html')}>
            Download Netscape HTML
          </button>
        </div>
      </div>

      <div class="space-y-2 rounded border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <h2 class="font-medium">Import</h2>
        <div class="flex flex-wrap gap-4 text-sm">
          <label class="block">
            JSON backup file
            <input
              class="mt-1 block"
              type="file"
              accept="application/json,.json"
              onChange={(e) => void onJsonFile((e.target as HTMLInputElement).files?.[0])}
            />
          </label>
          <label class="block">
            Netscape HTML file
            <input
              class="mt-1 block"
              type="file"
              accept=".html,.htm,text/html"
              onChange={(e) => void onHtmlFile((e.target as HTMLInputElement).files?.[0])}
            />
          </label>
        </div>
        {preview ? (
          <div class="rounded border px-2 py-1 text-sm">
            <p>
              Preview ({preview.kind}): {preview.add} will be added, {preview.update} updated,{' '}
              {preview.skip} skipped, {preview.total} total.
            </p>
            <label class="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck((e.target as HTMLInputElement).checked)} />
              I have exported a current backup first.
            </label>
            <button
              class="mt-2 rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
              disabled={!ack || busy}
              onClick={confirm}
            >
              Confirm import
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
