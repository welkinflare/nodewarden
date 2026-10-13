import { createApiError, parseErrorMessage, parseJson, type AuthedFetch } from './shared';

// Links (bookmarks) API client. All routes live under /api/links/* and use
// the Bitwarden session (AuthedFetch attaches the access token). Ids are
// TEXT UUIDs. Error bodies are linkflare-style {detail} (see parseLinksError).

export interface LinkBookmark {
  id: string;
  url: string;
  url_normalized?: string;
  title: string;
  description: string;
  notes: string;
  tag_names: string[];
  unread: number;
  is_archived: number;
  shared: number;
  web_archive_snapshot_url: string;
  favicon_url: string;
  preview_image_url: string;
  date_added: string;
  date_modified: string;
  date_accessed: string;
}

export interface LinkTag {
  id: string;
  name: string;
  date_added?: string;
  bookmark_count?: number;
}

export interface LinkBundle {
  id: string;
  name: string;
  search: string;
  any_tags: string;
  all_tags: string;
  excluded_tags: string;
  filter_unread: number;
  filter_shared: number;
  order: string;
}

export interface LinkProfile {
  theme: string;
  bookmark_date_display: string;
  bookmark_link_target: string;
  web_archive_integration: string;
  tag_search: string;
  enable_sharing: number;
  enable_public_sharing: number;
  enable_favicons: number;
  display_url: number;
  permanent_notes: number;
  search_preferences: string;
  auto_tagging_rules: string;
  items_per_page: number;
  legacy_search: number;
  custom_css: string;
  [key: string]: unknown;
}

export interface LinkApiToken {
  id: string;
  name: string;
  key: string;
  created: string;
}

export interface LinkFeedToken {
  key: string;
  created: string;
}

export type LinkBulkAction =
  | 'archive'
  | 'unarchive'
  | 'delete'
  | 'mark_read'
  | 'mark_unread'
  | 'add_tags'
  | 'remove_tags';

async function parseLinksError(resp: Response, fallback: string): Promise<Error> {
  const body = await parseJson<{ detail?: string }>(resp);
  const detail = typeof body?.detail === 'string' && body.detail ? body.detail : null;
  if (detail) return createApiError(detail, resp.status);
  return new Error(await parseErrorMessage(resp, `${fallback} (${resp.status})`));
}

async function linksGet<T>(authedFetch: AuthedFetch, path: string, fallback: string): Promise<T> {
  const resp = await authedFetch(path);
  if (resp.status === 204) return null as unknown as T;
  if (!resp.ok) throw await parseLinksError(resp, fallback);
  const data = await parseJson<T>(resp);
  if (data === null || data === undefined) throw new Error(fallback);
  return data;
}

async function linksMutate<T>(authedFetch: AuthedFetch, path: string, method: string, body: unknown, fallback: string): Promise<T> {
  const resp = await authedFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (resp.status === 204) return null as unknown as T;
  if (!resp.ok) throw await parseLinksError(resp, fallback);
  return (await parseJson<T>(resp)) as T;
}

export interface ListLinksParams {
  q?: string;
  limit?: number;
  offset?: number;
  bundle?: string;
  order?: string;
  archived?: boolean | 'all';
  unread?: boolean;
  shared?: boolean;
  untagged?: boolean;
}

export interface ListLinksResult {
  results: LinkBookmark[];
  count: number;
  next?: string | null;
  previous?: string | null;
}

export async function listLinkBookmarks(authedFetch: AuthedFetch, params: ListLinksParams = {}): Promise<ListLinksResult> {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.offset !== undefined) search.set('offset', String(params.offset));
  if (params.bundle) search.set('bundle', params.bundle);
  if (params.order) search.set('order', params.order);
  if (params.unread) search.set('unread', '1');
  if (params.shared) search.set('shared', '1');
  if (params.untagged) search.set('untagged', '1');
  const useArchivedEndpoint = params.archived === true;
  if (params.archived === 'all') search.set('archived', 'all');
  const base = useArchivedEndpoint ? '/api/links/bookmarks/archived' : '/api/links/bookmarks';
  const data = await linksGet<Record<string, unknown>>(authedFetch, search.toString() ? `${base}?${search}` : base, 'Load bookmarks failed');
  const results = Array.isArray(data['results']) ? (data['results'] as LinkBookmark[]) : [];
  return {
    results,
    count: typeof data['count'] === 'number' ? (data['count'] as number) : results.length,
    next: (data['next'] as string | null) ?? null,
    previous: (data['previous'] as string | null) ?? null,
  };
}

export interface LinkCheckResult {
  bookmark: LinkBookmark | null;
  metadata: { title: string; description: string; favicon_url?: string; preview_image_url?: string };
  auto_tags?: string[];
  url?: string;
}

export async function checkLinkBookmark(authedFetch: AuthedFetch, url: string): Promise<LinkCheckResult> {
  return linksGet<LinkCheckResult>(authedFetch, `/api/links/bookmarks/check?url=${encodeURIComponent(url)}`, 'Check bookmark failed');
}

export async function createLinkBookmark(authedFetch: AuthedFetch, payload: Record<string, unknown>): Promise<LinkBookmark> {
  return linksMutate<LinkBookmark>(authedFetch, '/api/links/bookmarks', 'POST', payload, 'Create bookmark failed');
}

export async function updateLinkBookmark(authedFetch: AuthedFetch, id: string, payload: Record<string, unknown>): Promise<LinkBookmark> {
  return linksMutate<LinkBookmark>(authedFetch, `/api/links/bookmarks/${encodeURIComponent(id)}`, 'PATCH', payload, 'Update bookmark failed');
}

export async function deleteLinkBookmark(authedFetch: AuthedFetch, id: string): Promise<void> {
  const resp = await authedFetch(`/api/links/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) throw await parseLinksError(resp, 'Delete bookmark failed');
}

export async function archiveLinkBookmark(authedFetch: AuthedFetch, id: string, archived: boolean): Promise<void> {
  const resp = await authedFetch(`/api/links/bookmarks/${encodeURIComponent(id)}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' });
  if (!resp.ok && resp.status !== 204) throw await parseLinksError(resp, 'Archive bookmark failed');
}

export async function bulkLinkBookmarks(
  authedFetch: AuthedFetch,
  bookmarkIds: string[],
  action: LinkBulkAction,
  tagNames?: string[],
): Promise<{ ok: boolean; affected: number }> {
  const payload: Record<string, unknown> = { bookmark_ids: bookmarkIds, action };
  if (tagNames !== undefined) payload['tag_names'] = tagNames;
  return linksMutate(authedFetch, '/api/links/bookmarks/bulk', 'POST', payload, 'Bulk action failed');
}

export async function listLinkTags(authedFetch: AuthedFetch): Promise<LinkTag[]> {
  return linksGet<LinkTag[]>(authedFetch, '/api/links/tags', 'Load tags failed');
}

export async function createLinkTag(authedFetch: AuthedFetch, name: string): Promise<LinkTag> {
  return linksMutate<LinkTag>(authedFetch, '/api/links/tags', 'POST', { name }, 'Create tag failed');
}

export async function renameLinkTag(authedFetch: AuthedFetch, id: string, name: string): Promise<LinkTag> {
  return linksMutate<LinkTag>(authedFetch, `/api/links/tags/${encodeURIComponent(id)}`, 'PATCH', { name }, 'Rename tag failed');
}

export async function deleteLinkTag(authedFetch: AuthedFetch, id: string): Promise<void> {
  const resp = await authedFetch(`/api/links/tags/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) throw await parseLinksError(resp, 'Delete tag failed');
}

export async function mergeLinkTags(authedFetch: AuthedFetch, from: string, to: string): Promise<void> {
  await linksMutate(authedFetch, '/api/links/tags/merge', 'POST', { from, to }, 'Merge tags failed');
}

export async function listLinkBundles(authedFetch: AuthedFetch): Promise<LinkBundle[]> {
  return linksGet<LinkBundle[]>(authedFetch, '/api/links/bundles', 'Load bundles failed');
}

export async function createLinkBundle(authedFetch: AuthedFetch, payload: Record<string, unknown>): Promise<LinkBundle> {
  return linksMutate<LinkBundle>(authedFetch, '/api/links/bundles', 'POST', payload, 'Create bundle failed');
}

export async function updateLinkBundle(authedFetch: AuthedFetch, id: string, payload: Record<string, unknown>): Promise<LinkBundle> {
  return linksMutate<LinkBundle>(authedFetch, `/api/links/bundles/${encodeURIComponent(id)}`, 'PATCH', payload, 'Update bundle failed');
}

export async function deleteLinkBundle(authedFetch: AuthedFetch, id: string): Promise<void> {
  const resp = await authedFetch(`/api/links/bundles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) throw await parseLinksError(resp, 'Delete bundle failed');
}

export async function getLinkProfile(authedFetch: AuthedFetch): Promise<LinkProfile> {
  return linksGet<LinkProfile>(authedFetch, '/api/links/user/profile', 'Load profile failed');
}

export async function updateLinkProfile(authedFetch: AuthedFetch, patch: Record<string, unknown>): Promise<LinkProfile> {
  return linksMutate<LinkProfile>(authedFetch, '/api/links/user/profile', 'PATCH', patch, 'Save profile failed');
}

export interface LinkTokensState {
  api_tokens: LinkApiToken[];
  feed_token: LinkFeedToken | null;
}

export async function getLinkTokens(authedFetch: AuthedFetch): Promise<LinkTokensState> {
  return linksGet<LinkTokensState>(authedFetch, '/api/links/settings/tokens', 'Load tokens failed');
}

export async function createLinkApiToken(authedFetch: AuthedFetch, name: string): Promise<LinkApiToken> {
  return linksMutate<LinkApiToken>(authedFetch, '/api/links/settings/tokens', 'POST', { name }, 'Create token failed');
}

export async function ensureLinkFeedToken(authedFetch: AuthedFetch): Promise<LinkFeedToken> {
  return linksMutate<LinkFeedToken>(authedFetch, '/api/links/settings/tokens', 'POST', { feed: true }, 'Create feed token failed');
}

export async function deleteLinkApiToken(authedFetch: AuthedFetch, id: string): Promise<void> {
  const resp = await authedFetch(`/api/links/settings/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!resp.ok && resp.status !== 204) throw await parseLinksError(resp, 'Delete token failed');
}

export interface LinkImportPreview {
  add: number;
  update: number;
  skip: number;
  total: number;
  preview: boolean;
}

export function downloadLinksExport(kind: 'export.json' | 'export.html'): void {
  const a = document.createElement('a');
  a.href = `/api/links/backup/${kind}`;
  a.download = kind === 'export.json' ? 'nodewarden-links-backup.json' : 'nodewarden-links-bookmarks.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function previewLinksImportJson(authedFetch: AuthedFetch, payload: unknown): Promise<LinkImportPreview> {
  return linksMutate<LinkImportPreview>(authedFetch, '/api/links/backup/import.json?preview=1', 'POST', payload, 'Preview import failed');
}

export async function confirmLinksImportJson(authedFetch: AuthedFetch, payload: unknown): Promise<LinkImportPreview> {
  return linksMutate<LinkImportPreview>(authedFetch, '/api/links/backup/import.json', 'POST', payload, 'Import failed');
}

export async function previewLinksImportHtml(authedFetch: AuthedFetch, html: string): Promise<LinkImportPreview> {
  const resp = await authedFetch('/api/links/backup/import.html?preview=1', {
    method: 'POST',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  });
  if (!resp.ok) throw await parseLinksError(resp, 'Preview import failed');
  const data = await parseJson<LinkImportPreview>(resp);
  if (!data) throw new Error('Preview import failed');
  return data;
}

export async function confirmLinksImportHtml(authedFetch: AuthedFetch, html: string): Promise<LinkImportPreview> {
  const resp = await authedFetch('/api/links/backup/import.html', {
    method: 'POST',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  });
  if (!resp.ok) throw await parseLinksError(resp, 'Import failed');
  const data = await parseJson<LinkImportPreview>(resp);
  if (!data) throw new Error('Import failed');
  return data;
}
