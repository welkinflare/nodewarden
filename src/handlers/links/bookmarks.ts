// Bookmark CRUD / upsert / archive / bulk (linkding parity).
// All reads and writes are scoped by the userId param; foreign or missing
// ids always answer with a generic 404 that leaks nothing.
// Creates upsert on UNIQUE(user_id, url_normalized): re-posting a URL
// (any case/trailing-slash/utm variant) returns the same row.
// Handler signature is (request, env, userId, ...) like folders.ts so the
// same handlers serve both the session routes (/api/links/*, userId from the
// Bitwarden JWT) and the public token routes (/api/bookmarks/*, userId from
// verifyLinksToken). Response shapes are linkding-compatible:
// {count,next,previous,results} lists, serialized bookmark objects,
// {bookmark,metadata,auto_tags,url} for check. Errors are {detail} with the
// status code carrying the meaning (never nodewarden ErrorModel here).
// Links must not perturb Vault sync: no notify, no updateRevisionDate,
// no audit writes.

import type { Env } from '../../types';
import { jsonResponse } from '../../utils/response';
import {
  LinksStorage,
  isLinksUniqueViolation,
  type LinkBookmarkRow,
  type LinkBundleRow,
} from '../../services/links-storage';
import { ensureHttpScheme, isValidHttpUrl, normalizeUrl } from '../../linkding/normalize';
import { applyAutoTags } from '../../linkding/autotag';
import { parseQuery } from '../../linkding/search';
import { googleFaviconUrl, scrapeMetadata } from '../../linkding/scraper';

const NOT_FOUND = 'Not found.';

// Handlers cap bulk selections at 100 ids so the chunked IN-lists in
// LinksStorage always stay under the D1 bind-variable limit.
export const LINKS_BULK_MAX_IDS = 100;

function parseFlag(value: unknown): number {
  return value === 1 || value === true || value === '1' || value === 'true' ? 1 : 0;
}

// Accepts linkding-style `tag_names: string[]` (also tolerates a single
// comma-separated string from hand-rolled clients).
function parseTagNames(body: Record<string, unknown>): string[] {
  const raw = body['tag_names'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const name = String(entry ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function unionTags(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...a, ...b]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// https://web.archive.org/web/<yyyymmddhhmmss>/<url> (UTC, no separators).
// Wayback snapshot LINK only — no snapshot content is stored (no R2/KV).
export function waybackSnapshotUrl(url: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `https://web.archive.org/web/${stamp}/${url}`;
}

// The links UI renders each favicon as an <img>, and the app CSP allows images
// only from 'self' and data:. Absolute third-party favicon URLs (scraped page
// icons and the Google s2 fallback) are therefore blocked in the browser.
// NodeWarden already exposes a same-origin website-icon proxy at
// /icons/{host}/icon.png — the same one the vault uses — so resolve every
// bookmark icon through it at serialization time. Doing this on read fixes
// existing rows with no migration, and keeps the stored favicon_url untouched
// for backup/export fidelity. The URL is absolute (request origin) so
// third-party API/token clients can resolve it too. The "no fallback=404"
// form returns the default globe icon instead of a 404, so bookmarks without
// a known icon render cleanly. The UI still gates rendering on the
// enable_favicons profile preference.
export function sameOriginFaviconUrl(url: string, origin: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host || !origin) return '';
    return `${origin.replace(/\/+$/, '')}/icons/${encodeURIComponent(host)}/icon.png`;
  } catch {
    return '';
  }
}

export function serializeBookmark(
  row: LinkBookmarkRow,
  tagNames: string[],
  origin: string
): Record<string, unknown> {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    notes: row.notes,
    tag_names: tagNames,
    unread: row.unread,
    is_archived: row.is_archived,
    shared: row.shared,
    web_archive_snapshot_url: row.web_archive_snapshot_url,
    favicon_url: origin ? sameOriginFaviconUrl(row.url, origin) : row.favicon_url,
    preview_image_url: row.preview_image_url,
    // Empty back-compat dummies, matching linkding's serializer which keeps
    // these fields (always empty) for older clients.
    website_title: '',
    website_description: '',
    date_added: row.date_added,
    date_modified: row.date_modified,
    date_accessed: row.date_accessed,
  };
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function resolveBundleFilter(
  store: LinksStorage,
  userId: string,
  url: URL
): Promise<LinkBundleRow | null> {
  const raw = url.searchParams.get('bundle');
  if (raw == null || String(raw).trim() === '') return null;
  const id = String(raw).trim();
  // Unknown/foreign ids are ignored (linkding parity: no filter, no 404).
  return (await store.getBundleById(userId, id)) ?? null;
}

function buildPageUrls(
  url: URL,
  count: number,
  limit: number,
  offset: number
): { next: string | null; previous: string | null } {
  let next: string | null = null;
  let previous: string | null = null;
  if (offset + limit < count) {
    const nextParams = new URLSearchParams(url.searchParams);
    nextParams.set('limit', String(limit));
    nextParams.set('offset', String(offset + limit));
    next = `${url.origin}${url.pathname}?${nextParams.toString()}`;
  }
  if (offset > 0) {
    const prevParams = new URLSearchParams(url.searchParams);
    prevParams.set('limit', String(limit));
    prevParams.set('offset', String(Math.max(0, offset - limit)));
    previous = `${url.origin}${url.pathname}?${prevParams.toString()}`;
  }
  return { next, previous };
}

// Shared linkding list core: q/limit<=100/offset/modified_since/
// added_since/bundle/order/unread/shared/untagged with user isolation.
// `archived` selects is_archived=0 vs 1; `?archived=all` lists everything
// (the "All" view); both endpoints share filters and {count,next,
// previous,results} shape.
async function listBookmarksWithFilters(
  req: Request,
  env: Env,
  userId: string,
  url: URL,
  defaultArchived: boolean
): Promise<Response> {
  void req;
  const store = new LinksStorage(env.DB);
  await store.ensureLinksProfile(userId);
  const profile = await store.getLinksProfile(userId);
  const q = url.searchParams.get('q') ?? '';
  const plan = parseQuery(q, { tag_search: profile?.tag_search ?? 'strict' });
  // Linkding default limit is 100, capped at 100.
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '', 10);
  const rawOffset = parseInt(url.searchParams.get('offset') ?? '', 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 100);
  const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);
  const bundle = await resolveBundleFilter(store, userId, url);
  const order = url.searchParams.get('order') ?? url.searchParams.get('sort') ?? null;
  const archived = url.searchParams.get('archived') === 'all' ? null : defaultArchived;
  const filters = {
    modifiedSince: url.searchParams.get('modified_since'),
    addedSince: url.searchParams.get('added_since'),
    bundle,
    order,
    unread: url.searchParams.get('unread') === '1',
    shared: url.searchParams.get('shared') === '1',
    untagged: url.searchParams.get('untagged') === '1',
  };
  const [count, rows] = await Promise.all([
    store.countBookmarks(userId, plan, archived, filters),
    store.searchBookmarks(userId, plan, { limit, offset, archived, ...filters }),
  ]);
  const tagsByBookmark = await store.getTagNamesForBookmarks(
    userId,
    rows.map((r) => r.id)
  );
  const { next, previous } = buildPageUrls(url, count, limit, offset);
  return jsonResponse({
    count,
    next,
    previous,
    results: rows.map((row) => serializeBookmark(row, tagsByBookmark.get(row.id) ?? [], url.origin)),
  });
}

export async function handleListBookmarks(
  request: Request,
  env: Env,
  userId: string,
  url: URL
): Promise<Response> {
  return listBookmarksWithFilters(request, env, userId, url, false);
}

export async function handleListArchivedBookmarks(
  request: Request,
  env: Env,
  userId: string,
  url: URL
): Promise<Response> {
  return listBookmarksWithFilters(request, env, userId, url, true);
}

// GET .../shared (linkding compat): shared, unarchived bookmarks of the
// authed user. Implemented as the standard list with the shared filter
// forced on, so counts/pagination behave identically.
export async function handleListSharedBookmarks(
  request: Request,
  env: Env,
  userId: string,
  url: URL
): Promise<Response> {
  const sharedUrl = new URL(url.toString());
  sharedUrl.searchParams.set('shared', '1');
  return listBookmarksWithFilters(request, env, userId, sharedUrl, false);
}

// GET check endpoint (linkding compat).
// Returns {bookmark, metadata, auto_tags, url}: bookmark is the serialized
// row for the same user + normalized URL (or null), metadata is a live
// fail-soft scrape preview, auto_tags are the rules that would apply, url
// echoes the input. Missing url is 400 {detail}.
export async function handleCheckBookmark(
  request: Request,
  env: Env,
  userId: string,
  url: URL
): Promise<Response> {
  void request;
  const rawUrl = ensureHttpScheme(url.searchParams.get('url') ?? '');
  if (!rawUrl) return jsonResponse({ detail: 'URL is required.' }, 400);
  const store = new LinksStorage(env.DB);
  await store.ensureLinksProfile(userId);
  const profile = await store.getLinksProfile(userId);
  const normalized = normalizeUrl(rawUrl);
  const existing = await store.getBookmarkByNormalized(userId, normalized);
  let bookmark: Record<string, unknown> | null = null;
  if (existing) {
    const tagNames =
      (await store.getTagNamesForBookmarks(userId, [existing.id])).get(existing.id) ?? [];
    bookmark = serializeBookmark(existing, tagNames, url.origin);
  }
  const scraped = await scrapeMetadata(rawUrl, env.ATTACHMENTS_KV ?? undefined);
  const metadata = {
    url: rawUrl,
    title: scraped.title,
    description: scraped.description,
    preview_image: scraped.preview_image_url,
    favicon_url: scraped.favicon_url,
    preview_image_url: scraped.preview_image_url,
  };
  const autoTags = applyAutoTags(rawUrl, profile?.auto_tagging_rules ?? '');
  return jsonResponse({ bookmark, metadata, auto_tags: autoTags, url: rawUrl });
}

export async function handleCreateBookmark(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const body = await readJsonBody(request);
  const rawUrl = ensureHttpScheme(body['url']);
  if (!rawUrl) return jsonResponse({ detail: 'URL is required.' }, 400);
  if (!isValidHttpUrl(rawUrl)) {
    return jsonResponse({ detail: 'Enter a valid URL.' }, 400);
  }

  const store = new LinksStorage(env.DB);
  const normalized = normalizeUrl(rawUrl);
  const now = new Date().toISOString();
  await store.ensureLinksProfile(userId);
  const profile = await store.getLinksProfile(userId);
  const enableFavicons = Number(profile?.enable_favicons ?? 1) !== 0;
  const sharingEnabled = Number(profile?.enable_sharing ?? 0) === 1;
  const waybackEnabled = (profile?.web_archive_integration ?? '') === 'enabled';
  const autoRules = profile?.auto_tagging_rules ?? '';
  const providedTags = parseTagNames(body);

  // Upsert: same user + same normalized URL updates in place, same id.
  // Answers 201 like a create (linkding/DRF parity): API clients such as the
  // browser extension treat any non-201 as a save failure.
  const existing = await store.getBookmarkByNormalized(userId, normalized);
  if (existing) {
    return applyUpsertUpdate(store, userId, existing, body, rawUrl, now, sharingEnabled, autoRules, new URL(request.url).origin);
  }

  // Create. Metadata is scraped (fail-soft) only when the client did not
  // supply a title, so titled creates never touch the network.
  let title = String(body['title'] ?? '').trim();
  let description = String(body['description'] ?? '').trim();
  let favicon = '';
  let preview = '';
  if (!title) {
    const scraped = await scrapeMetadata(rawUrl, env.ATTACHMENTS_KV ?? undefined);
    if (!title && scraped.title) title = scraped.title;
    if (!description && scraped.description) description = scraped.description;
    favicon = scraped.favicon_url;
    preview = scraped.preview_image_url;
  } else {
    try {
      favicon = googleFaviconUrl(new URL(rawUrl).hostname.toLowerCase());
    } catch {
      favicon = '';
    }
  }
  if (!enableFavicons) favicon = '';

  const tagNames = unionTags(providedTags, applyAutoTags(rawUrl, autoRules));
  let row: LinkBookmarkRow;
  try {
    row = await store.createBookmark({
      userId,
      url: rawUrl,
      urlNormalized: normalized,
      title,
      description,
      notes: String(body['notes'] ?? ''),
      unread: parseFlag(body['unread'] ?? 0),
      isArchived: parseFlag(body['is_archived'] ?? 0),
      shared: body['shared'] && sharingEnabled ? 1 : 0,
      webArchiveSnapshotUrl: waybackEnabled ? waybackSnapshotUrl(rawUrl) : '',
      faviconUrl: favicon,
      previewImageUrl: preview,
      now,
    });
  } catch (err) {
    // Check-then-insert race: a concurrent create for the same normalized
    // URL won the UNIQUE(user_id, url_normalized) insert. Converge onto the
    // winner via the upsert-update path (same id, 200) instead of a 500.
    if (!isLinksUniqueViolation(err)) throw err;
    const raced = await store.getBookmarkByNormalized(userId, normalized);
    if (!raced) throw err;
    return applyUpsertUpdate(store, userId, raced, body, rawUrl, now, sharingEnabled, autoRules, new URL(request.url).origin);
  }
  const tags = await store.ensureTags(userId, tagNames, now);
  await store.setBookmarkTagLinks(userId, row.id, tags.map((t) => t.id));
  return jsonResponse(serializeBookmark(row, tags.map((t) => t.name), new URL(request.url).origin), 201);
}

// Shared upsert-update for POST creates: applies posted fields onto the
// existing row for the same normalized URL and returns it (200, same id).
async function applyUpsertUpdate(
  store: LinksStorage,
  userId: string,
  existing: LinkBookmarkRow,
  body: Record<string, unknown>,
  rawUrl: string,
  now: string,
  sharingEnabled: boolean,
  autoRules: string,
  origin: string
): Promise<Response> {
  const patch: Record<string, unknown> = { url: rawUrl, date_modified: now };
  for (const field of ['title', 'description', 'notes'] as const) {
    if (body[field] !== undefined) patch[field] = String(body[field]);
  }
  if (body['unread'] !== undefined) patch['unread'] = parseFlag(body['unread']);
  if (body['is_archived'] !== undefined) {
    patch['is_archived'] = parseFlag(body['is_archived']);
  }
  if (body['shared'] !== undefined) {
    patch['shared'] = body['shared'] && sharingEnabled ? 1 : 0;
  }
  const updated = await store.updateBookmark(userId, existing.id, patch);
  if (!updated) return jsonResponse({ detail: NOT_FOUND }, 404);
  const autoTags = applyAutoTags(rawUrl, autoRules);
  let tagNames: string[];
  if (body['tag_names'] !== undefined) {
    tagNames = unionTags(parseTagNames(body), autoTags);
  } else {
    const current =
      (await store.getTagNamesForBookmarks(userId, [updated.id])).get(updated.id) ?? [];
    tagNames = unionTags(current, autoTags);
  }
  const tags = await store.ensureTags(userId, tagNames, now);
  await store.setBookmarkTagLinks(userId, updated.id, tags.map((t) => t.id));
  return jsonResponse(serializeBookmark(updated, tags.map((t) => t.name), origin), 201);
}

export async function handleGetBookmark(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const store = new LinksStorage(env.DB);
  const row = await store.getBookmarkById(userId, id);
  if (!row) return jsonResponse({ detail: NOT_FOUND }, 404);
  const tagNames = (await store.getTagNamesForBookmarks(userId, [row.id])).get(row.id) ?? [];
  return jsonResponse(serializeBookmark(row, tagNames, new URL(request.url).origin));
}

export async function handleUpdateBookmark(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const store = new LinksStorage(env.DB);
  const row = await store.getBookmarkById(userId, id);
  if (!row) return jsonResponse({ detail: NOT_FOUND }, 404);
  const body = await readJsonBody(request);
  const now = new Date().toISOString();
  await store.ensureLinksProfile(userId);
  const profile = await store.getLinksProfile(userId);
  const sharingEnabled = Number(profile?.enable_sharing ?? 0) === 1;
  const waybackEnabled = (profile?.web_archive_integration ?? '') === 'enabled';
  const autoRules = profile?.auto_tagging_rules ?? '';

  const patch: Record<string, unknown> = { date_modified: now };
  let nextUrl = row.url;
  if (body['url'] !== undefined) {
    const rawUrl = ensureHttpScheme(body['url']);
    if (!rawUrl || !isValidHttpUrl(rawUrl)) {
      return jsonResponse({ detail: 'Enter a valid URL.' }, 400);
    }
    const nextNormalized = normalizeUrl(rawUrl);
    if (nextNormalized !== row.url_normalized) {
      const collision = await store.getBookmarkByNormalized(userId, nextNormalized);
      if (collision && collision.id !== row.id) {
        return jsonResponse({ detail: 'A bookmark with this URL already exists.' }, 400);
      }
      patch['url'] = rawUrl;
      patch['url_normalized'] = nextNormalized;
      nextUrl = rawUrl;
      if (waybackEnabled) patch['web_archive_snapshot_url'] = waybackSnapshotUrl(rawUrl);
    } else if (rawUrl !== row.url) {
      patch['url'] = rawUrl;
      nextUrl = rawUrl;
    }
  }
  for (const field of ['title', 'description', 'notes'] as const) {
    if (body[field] !== undefined) patch[field] = String(body[field]);
  }
  if (body['unread'] !== undefined) patch['unread'] = parseFlag(body['unread']);
  if (body['is_archived'] !== undefined) {
    patch['is_archived'] = parseFlag(body['is_archived']);
  }
  if (body['shared'] !== undefined) {
    patch['shared'] = body['shared'] && sharingEnabled ? 1 : 0;
  }

  const updated = await store.updateBookmark(userId, id, patch);
  if (!updated) return jsonResponse({ detail: NOT_FOUND }, 404);

  const autoTags = applyAutoTags(nextUrl, autoRules);
  let tagNames: string[];
  if (body['tag_names'] !== undefined) {
    tagNames = unionTags(parseTagNames(body), autoTags);
  } else {
    const current = (await store.getTagNamesForBookmarks(userId, [id])).get(id) ?? [];
    tagNames = unionTags(current, autoTags);
  }
  const tags = await store.ensureTags(userId, tagNames, now);
  await store.setBookmarkTagLinks(userId, id, tags.map((t) => t.id));
  return jsonResponse(serializeBookmark(updated, tags.map((t) => t.name), new URL(request.url).origin), 200);
}

export async function handleDeleteBookmark(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  void request;
  const deleted = await new LinksStorage(env.DB).deleteBookmark(userId, id);
  if (!deleted) return jsonResponse({ detail: NOT_FOUND }, 404);
  return new Response(null, { status: 204 });
}

export async function handleArchiveBookmark(
  request: Request,
  env: Env,
  userId: string,
  id: string,
  archived: boolean
): Promise<Response> {
  const store = new LinksStorage(env.DB);
  const updated = await store.updateBookmark(userId, id, {
    is_archived: archived ? 1 : 0,
    date_modified: new Date().toISOString(),
  });
  // updateBookmark re-reads scoped by user_id: null means foreign/missing.
  if (!updated) return jsonResponse({ detail: NOT_FOUND }, 404);
  return new Response(null, { status: 204 });
}

const BULK_ACTIONS = new Set([
  'archive',
  'unarchive',
  'delete',
  'mark_read',
  'mark_unread',
  'add_tags',
  'remove_tags',
]);

export async function handleBulkBookmarks(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const body = await readJsonBody(request);
  const action = String(body['action'] ?? '');
  if (!BULK_ACTIONS.has(action)) {
    return jsonResponse({ detail: 'Unknown bulk action.' }, 400);
  }
  const rawIds = Array.isArray(body['bookmark_ids']) ? body['bookmark_ids'] : [];
  const ids = [...new Set(
    rawIds.map((v) => String(v ?? '').trim()).filter((s) => s.length > 0)
  )];
  if (ids.length > LINKS_BULK_MAX_IDS) {
    return jsonResponse(
      { detail: `Too many bookmark ids (max ${LINKS_BULK_MAX_IDS}).` },
      400
    );
  }
  const store = new LinksStorage(env.DB);
  const now = new Date().toISOString();
  let affected = 0;
  switch (action) {
    case 'archive':
      affected = await store.bulkSetArchived(userId, ids, true);
      break;
    case 'unarchive':
      affected = await store.bulkSetArchived(userId, ids, false);
      break;
    case 'delete':
      affected = await store.bulkDelete(userId, ids);
      break;
    case 'mark_read':
      affected = await store.bulkSetUnread(userId, ids, false);
      break;
    case 'mark_unread':
      affected = await store.bulkSetUnread(userId, ids, true);
      break;
    case 'add_tags': {
      const tagNames = parseTagNames(body);
      if (tagNames.length === 0) {
        return jsonResponse({ detail: 'tag_names is required for this action.' }, 400);
      }
      affected = await store.bulkAddTags(userId, ids, tagNames, now);
      break;
    }
    case 'remove_tags': {
      const tagNames = parseTagNames(body);
      if (tagNames.length === 0) {
        return jsonResponse({ detail: 'tag_names is required for this action.' }, 400);
      }
      affected = await store.bulkRemoveTags(userId, ids, tagNames);
      break;
    }
  }
  return jsonResponse({ ok: true, affected });
}
