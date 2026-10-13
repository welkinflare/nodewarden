// Links route dispatch.
// Two entry points sharing the same handlers (all take userId explicitly):
// - handleLinksRoute: session routes under /api/links/* (userId comes from
//   the Bitwarden JWT via handleAuthenticatedRoute; `Token` headers are NOT
//   honored here).
// - handleLinksTokenBookmarksRoute: public linkding-compat routes under
//   /api/bookmarks/* (Token-ONLY auth via verifyLinksToken; Bitwarden
//   Bearer JWTs are NOT accepted here). Unknown paths are a 404 {detail}
//   because this namespace is exclusively links (no Bitwarden routes live
//   under /api/bookmarks/*).
// The /api/links/* table mirrors linkflare 1:1 (same paths minus the
// prefix, same query params): bookmarks, bookmarks/bulk, bookmarks/check,
// bookmarks/archived, bookmarks/shared, bookmarks/:id + :id/archive|:id/unarchive, tags,
// tags/merge, tags/:id, bundles, bundles/:id, user/profile, settings,
// settings/tokens, settings/tokens/:id, backup/export.json|export.html,
// backup/import.json|import.html (with ?preview= dry-run).
// Ids are TEXT UUIDs: matchers accept [A-Za-z0-9-]{1,64} (never numeric
// \d+). Unmatched session paths return null so the authenticated router
// falls through to its 404; matched-path-wrong-method also returns null
// (same fall-through). Errors are {detail} everywhere.

import type { Env } from '../../types';
import { jsonResponse } from '../../utils/response';
import { verifyLinksToken } from './links-auth';
import {
  handleArchiveBookmark,
  handleBulkBookmarks,
  handleCheckBookmark,
  handleCreateBookmark,
  handleDeleteBookmark,
  handleGetBookmark,
  handleListArchivedBookmarks,
  handleListBookmarks,
  handleListSharedBookmarks,
  handleUpdateBookmark,
} from './bookmarks';
import {
  handleCreateBundle,
  handleDeleteBundle,
  handleGetBundle,
  handleListBundles,
  handleUpdateBundle,
} from './bundles';
import {
  handleCreateTag,
  handleDeleteTag,
  handleGetTag,
  handleListTags,
  handleMergeTags,
  handleUpdateTag,
} from './tags';
import {
  handleCreateLinksToken,
  handleDeleteLinksToken,
  handleGetLinksProfile,
  handleGetLinksSettings,
  handleListLinksTokens,
  handleUpdateLinksProfile,
  handleUpdateLinksSettings,
} from './settings';
import {
  handleLinksExportHtml,
  handleLinksExportJson,
  handleLinksImportHtml,
  handleLinksImportJson,
} from './backup';

export function normalizeLinksPath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

const UUID = '[A-Za-z0-9-]{1,64}';

function bookmarkRoutes(
  request: Request,
  env: Env,
  userId: string,
  url: URL,
  base: string,
  path: string,
  method: string
): Promise<Response> | null {
  if (path === `${base}` && method === 'GET') return handleListBookmarks(request, env, userId, url);
  if (path === `${base}` && method === 'POST') return handleCreateBookmark(request, env, userId);
  if (path === `${base}/bulk` && method === 'POST') return handleBulkBookmarks(request, env, userId);
  if (path === `${base}/check` && method === 'GET') return handleCheckBookmark(request, env, userId, url);
  if (path === `${base}/archived` && method === 'GET') {
    return handleListArchivedBookmarks(request, env, userId, url);
  }
  // Literal "shared" must match before :id (the UUID pattern would swallow it).
  if (path === `${base}/shared` && method === 'GET') {
    return handleListSharedBookmarks(request, env, userId, url);
  }
  const archiveMatch = new RegExp(`^${base}/(${UUID})/(archive|unarchive)$`).exec(path);
  if (archiveMatch && method === 'POST') {
    return handleArchiveBookmark(request, env, userId, archiveMatch[1], archiveMatch[2] === 'archive');
  }
  const bookmarkMatch = new RegExp(`^${base}/(${UUID})$`).exec(path);
  if (bookmarkMatch) {
    const id = bookmarkMatch[1];
    if (method === 'GET') return handleGetBookmark(request, env, userId, id);
    if (method === 'PUT' || method === 'PATCH') return handleUpdateBookmark(request, env, userId, id);
    if (method === 'DELETE') return handleDeleteBookmark(request, env, userId, id);
  }
  return null;
}

function tagRoutes(
  request: Request,
  env: Env,
  userId: string,
  base: string,
  path: string,
  method: string
): Promise<Response> | null {
  if (path === `${base}` && method === 'GET') return handleListTags(request, env, userId);
  if (path === `${base}` && method === 'POST') return handleCreateTag(request, env, userId);
  // Literal "merge" matches before :id so it is never an id.
  if (path === `${base}/merge` && method === 'POST') return handleMergeTags(request, env, userId);
  const tagMatch = new RegExp(`^${base}/(${UUID})$`).exec(path);
  if (tagMatch) {
    const id = tagMatch[1];
    if (method === 'GET') return handleGetTag(request, env, userId, id);
    if (method === 'PUT' || method === 'PATCH') return handleUpdateTag(request, env, userId, id);
    if (method === 'DELETE') return handleDeleteTag(request, env, userId, id);
  }
  return null;
}

function bundleRoutes(
  request: Request,
  env: Env,
  userId: string,
  base: string,
  path: string,
  method: string
): Promise<Response> | null {
  if (path === `${base}` && method === 'GET') return handleListBundles(request, env, userId);
  if (path === `${base}` && method === 'POST') return handleCreateBundle(request, env, userId);
  const bundleMatch = new RegExp(`^${base}/(${UUID})$`).exec(path);
  if (bundleMatch) {
    const id = bundleMatch[1];
    if (method === 'GET') return handleGetBundle(request, env, userId, id);
    if (method === 'PUT' || method === 'PATCH') return handleUpdateBundle(request, env, userId, id);
    if (method === 'DELETE') return handleDeleteBundle(request, env, userId, id);
  }
  return null;
}

export async function handleLinksRoute(
  request: Request,
  env: Env,
  userId: string,
  path: string,
  method: string
): Promise<Response | null> {
  const p = normalizeLinksPath(path);
  const url = new URL(request.url);

  const bookmarks = bookmarkRoutes(request, env, userId, url, '/api/links/bookmarks', p, method);
  if (bookmarks) return bookmarks;

  const tags = tagRoutes(request, env, userId, '/api/links/tags', p, method);
  if (tags) return tags;

  const bundles = bundleRoutes(request, env, userId, '/api/links/bundles', p, method);
  if (bundles) return bundles;

  if (p === '/api/links/user/profile' && method === 'GET') {
    return handleGetLinksProfile(request, env, userId);
  }
  if (p === '/api/links/user/profile' && (method === 'PATCH' || method === 'PUT')) {
    return handleUpdateLinksProfile(request, env, userId);
  }
  if (p === '/api/links/settings' && method === 'GET') {
    return handleGetLinksSettings(request, env, userId);
  }
  if (p === '/api/links/settings' && (method === 'PUT' || method === 'PATCH')) {
    return handleUpdateLinksSettings(request, env, userId);
  }

  if (p === '/api/links/settings/tokens' && method === 'GET') {
    return handleListLinksTokens(request, env, userId);
  }
  if (p === '/api/links/settings/tokens' && method === 'POST') {
    return handleCreateLinksToken(request, env, userId);
  }
  const tokenMatch = new RegExp(`^/api/links/settings/tokens/(${UUID})$`).exec(p);
  if (tokenMatch && method === 'DELETE') {
    return handleDeleteLinksToken(request, env, userId, tokenMatch[1]);
  }

  if (p === '/api/links/backup/export.json' && method === 'GET') {
    return handleLinksExportJson(request, env, userId);
  }
  if (p === '/api/links/backup/export.html' && method === 'GET') {
    return handleLinksExportHtml(request, env, userId);
  }
  if (p === '/api/links/backup/import.json' && method === 'POST') {
    return handleLinksImportJson(request, env, userId, url);
  }
  if (p === '/api/links/backup/import.html' && method === 'POST') {
    return handleLinksImportHtml(request, env, userId, url);
  }

  return null;
}

// Public linkding-compat entry: Token-ONLY auth, then the same bookmark
// table (no tags/bundles/settings/backup on the public namespace —
// linkding clients use the token for bookmarks; everything else is
// session-only under /api/links/*).
export async function handleLinksTokenBookmarksRoute(
  request: Request,
  env: Env,
  path: string,
  method: string
): Promise<Response> {
  const authed = await verifyLinksToken(request, env);
  if (!authed) return jsonResponse({ detail: 'Authentication required.' }, 401);
  const p = normalizeLinksPath(path);
  const url = new URL(request.url);
  const routed = bookmarkRoutes(request, env, authed.userId, url, '/api/bookmarks', p, method);
  if (routed) return routed;
  return jsonResponse({ detail: 'Not found.' }, 404);
}
