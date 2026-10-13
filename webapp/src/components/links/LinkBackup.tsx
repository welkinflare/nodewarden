import { useRef, useState } from 'preact/hooks';
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
  const [jsonName, setJsonName] = useState('');
  const [htmlName, setHtmlName] = useState('');
  const jsonRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLInputElement>(null);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
    queryClient.invalidateQueries({ queryKey: ['links-tags'] });
    queryClient.invalidateQueries({ queryKey: ['links-bundles'] });
  }

  async function onJsonFile(file: File | undefined) {
    if (!file) return;
    setJsonName(file.name);
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
    setHtmlName(file.name);
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
      {error ? <p class="links-error">{error}</p> : null}
      {info ? <p class="links-ok">{info}</p> : null}

      <div class="card p-3">
        <h2 class="mb-2 font-medium">Export</h2>
        <div class="flex flex-wrap gap-2 text-sm">
          <button class="btn btn-primary small" onClick={() => downloadLinksExport('export.json')}>
            Download JSON backup
          </button>
          <button class="btn btn-secondary small" onClick={() => downloadLinksExport('export.html')}>
            Download Netscape HTML
          </button>
        </div>
      </div>

      <div class="space-y-2 card p-3">
        <h2 class="font-medium">Import</h2>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <input
            ref={jsonRef}
            class="hidden"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              void onJsonFile(input.files?.[0]);
              input.value = '';
            }}
          />
          <button class="btn btn-secondary small" onClick={() => jsonRef.current?.click()}>
            Choose JSON backup…
          </button>
          {jsonName ? <span class="links-hint">{jsonName}</span> : null}
          <input
            ref={htmlRef}
            class="hidden"
            type="file"
            accept=".html,.htm,text/html"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              void onHtmlFile(input.files?.[0]);
              input.value = '';
            }}
          />
          <button class="btn btn-secondary small" onClick={() => htmlRef.current?.click()}>
            Choose Netscape HTML…
          </button>
          {htmlName ? <span class="links-hint">{htmlName}</span> : null}
        </div>
        {preview ? (
          <div class="card px-2 py-1 text-sm">
            <p>
              Preview ({preview.kind}): {preview.add} will be added, {preview.update} updated,{' '}
              {preview.skip} skipped, {preview.total} total.
            </p>
            <label class="mt-1 flex items-center gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck((e.target as HTMLInputElement).checked)} />
              I have exported a current backup first.
            </label>
            <button
              class="btn btn-primary small"
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
