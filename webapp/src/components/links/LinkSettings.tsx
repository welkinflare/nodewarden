import { useEffect, useState } from 'preact/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthedFetch } from '@/lib/api/shared';
import {
  createLinkApiToken,
  deleteLinkApiToken,
  ensureLinkFeedToken,
  getLinkProfile,
  getLinkTokens,
  updateLinkProfile,
} from '@/lib/api/links';

type Tab = 'prefs' | 'autotag' | 'token' | 'feed';

function Flag({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      {label}
    </label>
  );
}

export function LinkSettings({ linksFetch }: { linksFetch: AuthedFetch }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('prefs');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const profileQuery = useQuery({
    queryKey: ['links-profile'],
    queryFn: () => getLinkProfile(linksFetch),
    retry: false,
  });
  const tokensQuery = useQuery({
    queryKey: ['links-tokens'],
    queryFn: () => getLinkTokens(linksFetch),
    retry: false,
  });

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (profileQuery.data && draft === null) setDraft({ ...profileQuery.data });
  }, [profileQuery.data, draft]);

  async function saveProfile() {
    if (!draft) return;
    setError('');
    setSaved('');
    try {
      const updated = await updateLinkProfile(linksFetch, draft);
      setDraft({ ...updated });
      queryClient.invalidateQueries({ queryKey: ['links-profile'] });
      queryClient.invalidateQueries({ queryKey: ['links-bookmarks'] });
      setSaved('Settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    }
  }

  function setField(key: string, value: unknown) {
    setDraft((d) => ({ ...(d ?? {}), [key]: value }));
  }

  const flag = (key: string) => Number(draft?.[key] ?? 0) === 1;
  const str = (key: string) => String(draft?.[key] ?? '');

  async function createToken() {
    const name = prompt('Token name (e.g. linkding extension):');
    if (name === null) return;
    try {
      await createLinkApiToken(linksFetch, name);
      queryClient.invalidateQueries({ queryKey: ['links-tokens'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Token creation failed.');
    }
  }

  async function removeToken(id: string) {
    if (!confirm('Delete this API token? Extension/clients using it will break.')) return;
    try {
      await deleteLinkApiToken(linksFetch, id);
      queryClient.invalidateQueries({ queryKey: ['links-tokens'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Token deletion failed.');
    }
  }

  async function createFeedToken() {
    try {
      await ensureLinkFeedToken(linksFetch);
      queryClient.invalidateQueries({ queryKey: ['links-tokens'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Feed token failed.');
    }
  }

  const feedKey = tokensQuery.data?.feed_token?.key ?? '';
  const feedBase = typeof window !== 'undefined' ? window.location.origin : '';
  const feedUrls = feedKey
    ? (['all', 'unread', 'shared'] as const).map(
        (kind) => `${feedBase}/api/links/feeds/${kind}.atom?token=${feedKey}`,
      )
    : [];

  const tabs: Array<[Tab, string]> = [
    ['prefs', 'Preferences'],
    ['autotag', 'Auto-tagging'],
    ['token', 'API tokens'],
    ['feed', 'Feed'],
  ];

  return (
    <div class="space-y-3">
      {error ? <p class="links-error">{error}</p> : null}
      {saved ? <p class="links-ok">{saved}</p> : null}
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

      {tab === 'prefs' ? (
        <div class="card space-y-2 p-3">
          {draft ? (
            <>
              <label class="block text-sm">
                Date display
                <select
                  class="input"
                  value={str('bookmark_date_display') || 'relative'}
                  onChange={(e) => setField('bookmark_date_display', (e.target as HTMLSelectElement).value)}
                >
                  <option value="relative">relative</option>
                  <option value="absolute">absolute</option>
                </select>
              </label>
              <label class="block text-sm">
                Link target
                <select
                  class="input"
                  value={str('bookmark_link_target') || '_blank'}
                  onChange={(e) => setField('bookmark_link_target', (e.target as HTMLSelectElement).value)}
                >
                  <option value="_blank">_blank</option>
                  <option value="_self">_self</option>
                </select>
              </label>
              <label class="block text-sm">
                Tag search
                <select
                  class="input"
                  value={str('tag_search') || 'strict'}
                  onChange={(e) => setField('tag_search', (e.target as HTMLSelectElement).value)}
                >
                  <option value="strict">strict</option>
                  <option value="loose">loose</option>
                </select>
              </label>
              <Flag label="Show favicons" value={flag('enable_favicons')} onChange={(v) => setField('enable_favicons', v ? 1 : 0)} />
              <Flag label="Show display URL" value={flag('display_url')} onChange={(v) => setField('display_url', v ? 1 : 0)} />
              <Flag label="Always show notes" value={flag('permanent_notes')} onChange={(v) => setField('permanent_notes', v ? 1 : 0)} />
              <Flag label="Enable sharing" value={flag('enable_sharing')} onChange={(v) => setField('enable_sharing', v ? 1 : 0)} />
              <Flag label="Enable public sharing" value={flag('enable_public_sharing')} onChange={(v) => setField('enable_public_sharing', v ? 1 : 0)} />
              <Flag label="Wayback Machine integration" value={str('web_archive_integration') === 'enabled'} onChange={(v) => setField('web_archive_integration', v ? 'enabled' : 'disabled')} />
              <label class="block text-sm">
                Items per page
                <input
                  class="input w-20"
                  type="number"
                  min={1}
                  max={100}
                  value={Number(draft['items_per_page'] ?? 30)}
                  onInput={(e) => setField('items_per_page', Number((e.target as HTMLInputElement).value))}
                />
              </label>
              <button class="btn btn-primary small" onClick={saveProfile}>
                Save preferences
              </button>
            </>
          ) : (
            <p class="text-sm">Loading…</p>
          )}
        </div>
      ) : null}

      {tab === 'autotag' ? (
        <div class="card space-y-2 p-3">
          <p class="links-hint">
            One rule per line: <code>pattern tag1,tag2</code> (substring/wildcard match on URL).
          </p>
          {draft ? (
            <>
              <textarea
                class="input w-full font-mono"
                rows={8}
                value={str('auto_tagging_rules')}
                onInput={(e) => setField('auto_tagging_rules', (e.target as HTMLTextAreaElement).value)}
                placeholder={'example.com reading\n*.pdf pdf,docs'}
              />
              <button class="btn btn-primary small" onClick={saveProfile}>
                Save rules
              </button>
            </>
          ) : (
            <p class="text-sm">Loading…</p>
          )}
        </div>
      ) : null}

      {tab === 'token' ? (
        <div class="card space-y-2 p-3">
          <div class="flex items-center gap-2">
            <h2 class="font-medium">API tokens (extension: <code>Authorization: Token &lt;key&gt;</code>)</h2>
            <span class="flex-1" />
            <button class="btn btn-primary small" onClick={createToken}>
              New token
            </button>
          </div>
          <p class="links-hint">
            Point the official linkding browser extension at this server URL and paste a token here.
          </p>
          <ul class="space-y-1">
            {(tokensQuery.data?.api_tokens ?? []).map((token) => (
              <li key={token.id} class="card flex flex-wrap items-center gap-2 px-2 py-1 font-mono text-xs">
                <span>{token.name || '(unnamed)'}</span>
                <span class="break-all">{token.key}</span>
                <span class="flex-1" />
                <button
                  class="btn btn-danger small"
                  onClick={() => removeToken(token.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
          {(tokensQuery.data?.api_tokens ?? []).length === 0 ? (
            <p class="links-hint">No API tokens yet.</p>
          ) : null}
        </div>
      ) : null}

      {tab === 'feed' ? (
        <div class="card space-y-2 p-3">
          <h2 class="font-medium">Feed URLs (copy into your reader)</h2>
          {feedKey ? (
            <ul class="space-y-1 font-mono text-xs">
              {feedUrls.map((u) => (
                <li key={u} class="card break-all px-2 py-1">
                  {u}{' '}
                  <button
                    class="btn btn-secondary small"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(u);
                      } catch {
                        // clipboard unavailable
                      }
                    }}
                  >
                    Copy
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div class="flex items-center gap-2 text-sm">
              <span>No feed token yet.</span>
              <button class="btn btn-primary small" onClick={createFeedToken}>
                Create feed token
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
