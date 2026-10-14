// Manual backup: Netscape HTML + full JSON export/import with preview
// counts -> confirm via the bookmarks upsert path. Ported from linkflare's
// backup handler MINUS the scheduled-jobs surface (no backup_jobs /
// backup_runs tables exist in nodewarden): export.json, export.html,
// import.json, import.html only. `?preview=1` dry-runs an import and
// returns {add, update, skip, total, preview:true} without writing.
// Errors are {detail}; no vault-sync side effects.

import type { Env } from '../../types';
import { jsonResponse } from '../../utils/response';
import { LinksStorage, type LinkBookmarkRow } from '../../services/links-storage';
import { ensureHttpScheme, isValidHttpUrl, normalizeUrl } from '../../linkding/normalize';
import { buildNetscape, parseNetscape } from '../../linkding/netscape';

// Export payload version marker (linkflare exports carried its app VERSION;
// nodewarden-links uses its own marker so restores stay distinguishable).
const LINKS_EXPORT_VERSION = 'nodewarden-links/1.0';

interface ImportEntry {
  url: string;
  title: string;
  description: string;
  notes: string;
  tag_names: string[];
  unread: number;
  is_archived: number;
  shared: number;
  date_added: string;
  date_modified: string;
  date_accessed: string;
  web_archive_snapshot_url: string;
  favicon_url: string;
  preview_image_url: string;
}

function parseFlag(value: unknown): number {
  return value === 1 || value === true || value === '1' || value === 'true' ? 1 : 0;
}

function parseTagNamesFlexible(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
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

// --- Export builder ---

export async function buildLinksExportForUser(
  env: Env,
  userId: string
): Promise<Record<string, unknown>> {
  const store = new LinksStorage(env.DB);
  const now = new Date().toISOString();
  await store.ensureLinksProfile(userId);
  const [bookmarks, tags, bundles, profile] = await Promise.all([
    store.listAllBookmarks(userId),
    store.listTags(userId),
    store.listBundles(userId),
    store.getLinksProfile(userId),
  ]);
  const tagMap = await store.getTagNamesForBookmarks(
    userId,
    bookmarks.map((r) => r.id)
  );
  return {
    version: LINKS_EXPORT_VERSION,
    exported_at: now,
    user: { id: userId },
    bookmarks: bookmarks.map((r) => ({
      url: r.url,
      url_normalized: r.url_normalized,
      title: r.title,
      description: r.description,
      notes: r.notes,
      tag_names: tagMap.get(r.id) ?? [],
      unread: r.unread,
      is_archived: r.is_archived,
      shared: r.shared,
      web_archive_snapshot_url: r.web_archive_snapshot_url,
      favicon_url: r.favicon_url,
      preview_image_url: r.preview_image_url,
      date_added: r.date_added,
      date_modified: r.date_modified,
      date_accessed: r.date_accessed,
    })),
    tags,
    bundles,
    profile,
  };
}

// --- Import normalization / preview / apply ---

function toImportEntries(raw: unknown): ImportEntry[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['bookmarks'])) list = obj['bookmarks'] as unknown[];
    else if (Array.isArray(obj['results'])) list = obj['results'] as unknown[];
    else if (typeof obj['url'] === 'string') list = [obj];
    else list = [];
  }
  const out: ImportEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const url = String(e['url'] ?? e['URL'] ?? '').trim();
    const tagRaw = e['tag_names'] !== undefined ? e['tag_names'] : e['tags'];
    out.push({
      url,
      title: String(e['title'] ?? ''),
      description: String(e['description'] ?? ''),
      notes: String(e['notes'] ?? ''),
      tag_names: parseTagNamesFlexible(tagRaw),
      unread: parseFlag(e['unread'] ?? 0),
      is_archived: parseFlag(e['is_archived'] ?? e['archived'] ?? 0),
      shared: parseFlag(e['shared'] ?? 0),
      date_added: String(e['date_added'] ?? e['dateAdded'] ?? e['added'] ?? ''),
      date_modified: String(e['date_modified'] ?? e['dateModified'] ?? e['modified'] ?? ''),
      date_accessed: String(e['date_accessed'] ?? ''),
      web_archive_snapshot_url: String(e['web_archive_snapshot_url'] ?? ''),
      favicon_url: String(e['favicon_url'] ?? e['favicon'] ?? ''),
      preview_image_url: String(e['preview_image_url'] ?? e['preview_image'] ?? ''),
    });
  }
  return out;
}

function netscapeEntriesToImport(
  parsed: Array<{ url: string; title: string; description: string; notes?: string; tags: string[]; dateAdded: string }>
): ImportEntry[] {
  return parsed.map((p) => ({
    url: String(p.url ?? '').trim(),
    title: String(p.title ?? ''),
    description: String(p.description ?? ''),
    notes: String(p.notes ?? ''),
    tag_names: Array.isArray(p.tags) ? p.tags.map((t) => String(t)) : [],
    unread: 0,
    is_archived: 0,
    shared: 0,
    date_added: String(p.dateAdded ?? ''),
    date_modified: '',
    date_accessed: '',
    web_archive_snapshot_url: '',
    favicon_url: '',
    preview_image_url: '',
  }));
}

function bookmarkContentEqual(
  row: LinkBookmarkRow,
  entry: ImportEntry,
  existingTags: string[]
): boolean {
  if ((row.title ?? '') !== entry.title) return false;
  if ((row.description ?? '') !== entry.description) return false;
  if ((row.notes ?? '') !== entry.notes) return false;
  if (Number(row.unread ?? 0) !== entry.unread) return false;
  if (Number(row.is_archived ?? 0) !== entry.is_archived) return false;
  if (Number(row.shared ?? 0) !== entry.shared) return false;
  const a = [...new Set(existingTags.map((t) => t.toLowerCase()))].sort();
  const b = [...new Set(entry.tag_names.map((t) => t.toLowerCase()))].sort();
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export async function computeLinksImportPreview(
  env: Env,
  userId: string,
  entries: ImportEntry[]
): Promise<{ add: number; update: number; skip: number; total: number }> {
  const store = new LinksStorage(env.DB);
  let add = 0;
  let update = 0;
  let skip = 0;
  for (const entry of entries) {
    const url = ensureHttpScheme(entry.url);
    if (!url || !isValidHttpUrl(url)) {
      skip++;
      continue;
    }
    const normalized = normalizeUrl(url);
    const existing = await store.getBookmarkByNormalized(userId, normalized);
    if (!existing) {
      add++;
      continue;
    }
    const tags = (await store.getTagNamesForBookmarks(userId, [existing.id])).get(existing.id) ?? [];
    if (bookmarkContentEqual(existing, entry, tags)) skip++;
    else update++;
  }
  return { add, update, skip, total: entries.length };
}

function validIsoOrNull(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export async function applyLinksImportEntries(
  env: Env,
  userId: string,
  entries: ImportEntry[]
): Promise<{ add: number; update: number; skip: number; total: number }> {
  const store = new LinksStorage(env.DB);
  await store.ensureLinksProfile(userId);
  let add = 0;
  let update = 0;
  let skip = 0;
  for (const entry of entries) {
    const url = ensureHttpScheme(entry.url);
    if (!url || !isValidHttpUrl(url)) {
      skip++;
      continue;
    }
    const normalized = normalizeUrl(url);
    const existing = await store.getBookmarkByNormalized(userId, normalized);
    const now = new Date().toISOString();
    if (!existing) {
      const row = await store.createBookmark({
        userId,
        url,
        urlNormalized: normalized,
        title: entry.title,
        description: entry.description,
        notes: entry.notes,
        unread: entry.unread,
        isArchived: entry.is_archived,
        shared: entry.shared,
        webArchiveSnapshotUrl: entry.web_archive_snapshot_url,
        faviconUrl: entry.favicon_url,
        previewImageUrl: entry.preview_image_url,
        now,
      });
      const tags = await store.ensureTags(userId, entry.tag_names, now);
      await store.setBookmarkTagLinks(userId, row.id, tags.map((t) => t.id));
      // Preserve exported timestamps when present (fidelity for restores).
      const dateAdded = validIsoOrNull(entry.date_added);
      const dateModified = validIsoOrNull(entry.date_modified);
      const dateAccessed = validIsoOrNull(entry.date_accessed);
      if (dateAdded || dateModified || dateAccessed) {
        try {
          await env.DB.prepare(
            'UPDATE link_bookmarks SET date_added = COALESCE(?, date_added), date_modified = COALESCE(?, date_modified), date_accessed = COALESCE(?, date_accessed) WHERE id = ? AND user_id = ?'
          )
            .bind(dateAdded, dateModified ?? now, dateAccessed, row.id, userId)
            .run();
        } catch {
          // Timestamp fidelity is best-effort; the row itself is written.
        }
      }
      add++;
      continue;
    }
    const tags = (await store.getTagNamesForBookmarks(userId, [existing.id])).get(existing.id) ?? [];
    if (bookmarkContentEqual(existing, entry, tags)) {
      skip++;
      continue;
    }
    const patch: Record<string, unknown> = {
      url,
      title: entry.title,
      description: entry.description,
      notes: entry.notes,
      unread: entry.unread,
      is_archived: entry.is_archived,
      shared: entry.shared,
      date_modified: validIsoOrNull(entry.date_modified) ?? now,
    };
    if (entry.web_archive_snapshot_url !== undefined) patch['web_archive_snapshot_url'] = entry.web_archive_snapshot_url;
    if (entry.favicon_url !== undefined) patch['favicon_url'] = entry.favicon_url;
    if (entry.preview_image_url !== undefined) patch['preview_image_url'] = entry.preview_image_url;
    if (validIsoOrNull(entry.date_accessed)) patch['date_accessed'] = validIsoOrNull(entry.date_accessed);
    await store.updateBookmark(userId, existing.id, patch);
    const nextTags = await store.ensureTags(userId, entry.tag_names, now);
    await store.setBookmarkTagLinks(userId, existing.id, nextTags.map((t) => t.id));
    update++;
  }
  return { add, update, skip, total: entries.length };
}

async function restoreBundlesAndProfile(env: Env, userId: string, raw: unknown): Promise<void> {
  // Best-effort full-restore for bundles/profile/tags carried in the JSON
  // export. Bookmark tags already recreate used tags; standalone tags are
  // ensured here. Failures never block the bookmark import itself.
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const obj = raw as Record<string, unknown>;
    const store = new LinksStorage(env.DB);
    if (Array.isArray(obj['tags'])) {
      const names = (obj['tags'] as Array<Record<string, unknown>>)
        .map((t) => String(t['name'] ?? '').trim())
        .filter((n) => n.length > 0);
      if (names.length > 0) await store.ensureTags(userId, names, new Date().toISOString());
    }
    if (Array.isArray(obj['bundles'])) {
      const existing = await store.listBundles(userId);
      const byName = new Map(existing.map((b) => [b.name.toLowerCase(), b]));
      for (const item of obj['bundles'] as Array<Record<string, unknown>>) {
        const name = String(item['name'] ?? '').trim();
        if (!name) continue;
        const now = new Date().toISOString();
        const found = byName.get(name.toLowerCase());
        const fields = {
          search: String(item['search'] ?? ''),
          anyTags: String(item['any_tags'] ?? item['anyTags'] ?? ''),
          allTags: String(item['all_tags'] ?? item['allTags'] ?? ''),
          excludedTags: String(item['excluded_tags'] ?? item['excludedTags'] ?? ''),
          filterUnread: parseFlag(item['filter_unread'] ?? 0),
          filterShared: parseFlag(item['filter_shared'] ?? 0),
          order: String(item['order'] ?? ''),
        };
        if (!found) {
          await store.createBundle({ userId, name, ...fields, now });
        } else {
          await store.updateBundle(userId, found.id, {
            search: fields.search,
            any_tags: fields.anyTags,
            all_tags: fields.allTags,
            excluded_tags: fields.excludedTags,
            filter_unread: fields.filterUnread,
            filter_shared: fields.filterShared,
            order: fields.order,
            date_modified: now,
          });
        }
      }
    }
    if (obj['profile'] && typeof obj['profile'] === 'object') {
      const profile = obj['profile'] as Record<string, unknown>;
      const allow = new Set([
        'theme', 'bookmark_date_display', 'bookmark_link_target',
        'web_archive_integration', 'tag_search', 'enable_sharing',
        'enable_public_sharing', 'enable_favicons', 'display_url',
        'permanent_notes', 'search_preferences', 'auto_tagging_rules',
        'items_per_page', 'legacy_search', 'custom_css',
      ]);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(profile)) {
        if (allow.has(k)) patch[k] = v;
      }
      if (Object.keys(patch).length > 0) await store.updateLinksProfile(userId, patch);
    }
  } catch {
    // Best-effort only.
  }
}

// --- Body readers (JSON + multipart + raw text tolerant) ---

async function readJsonImportBody(req: Request): Promise<{ raw: unknown; parseError: boolean }> {
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const candidates = ['file', 'import', 'backup', 'json', 'html'];
      for (const key of candidates) {
        const value = form.get(key);
        if (typeof value === 'string' && value.trim()) {
          try {
            return { raw: JSON.parse(value), parseError: false };
          } catch {
            return { raw: value, parseError: true };
          }
        }
        if (value && typeof value === 'object' && 'text' in value) {
          const text = await (value as unknown as File).text();
          if (!text.trim()) continue;
          try {
            return { raw: JSON.parse(text), parseError: false };
          } catch {
            return { raw: text, parseError: true };
          }
        }
      }
      // Fall back to the first file part regardless of field name.
      for (const value of form.values()) {
        if (value && typeof value === 'object' && 'text' in value) {
          const text = await (value as unknown as File).text();
          if (!text.trim()) continue;
          try {
            return { raw: JSON.parse(text), parseError: false };
          } catch {
            return { raw: text, parseError: true };
          }
        }
      }
      return { raw: null, parseError: true };
    }
    const text = await req.text();
    if (!text.trim()) return { raw: null, parseError: true };
    try {
      return { raw: JSON.parse(text), parseError: false };
    } catch {
      return { raw: text, parseError: true };
    }
  } catch {
    return { raw: null, parseError: true };
  }
}

async function readHtmlImportText(req: Request): Promise<string | null> {
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const candidates = ['file', 'import', 'backup', 'html'];
      for (const key of candidates) {
        const value = form.get(key);
        if (typeof value === 'string' && value.trim()) return value;
        if (value && typeof value === 'object' && 'text' in value) {
          const text = await (value as unknown as File).text();
          if (text.trim()) return text;
        }
      }
      for (const value of form.values()) {
        if (typeof value === 'string' && value.trim()) return value;
        if (value && typeof value === 'object' && 'text' in value) {
          const text = await (value as unknown as File).text();
          if (text.trim()) return text;
        }
      }
      return null;
    }
    const text = await req.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

// --- Export handlers (per-user scope only; no site-scope: nodewarden admin
// backup lives in src/router-admin-backup.ts and must not gain a links
// bypass here) ---

export async function handleLinksExportJson(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  void request;
  const data = await buildLinksExportForUser(env, userId);
  return jsonResponse(data, 200, { 'Content-Disposition': 'attachment; filename="nodewarden-links-backup.json"' });
}

export async function handleLinksExportHtml(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  void request;
  const data = await buildLinksExportForUser(env, userId);
  const bookmarks = (data['bookmarks'] as Array<Record<string, unknown>>) ?? [];
  const html = buildNetscape(
    bookmarks.map((b) => ({
      url: String(b['url'] ?? ''),
      title: String(b['title'] ?? b['url'] ?? ''),
      description: String(b['description'] ?? ''),
      notes: String(b['notes'] ?? ''),
      tags: Array.isArray(b['tag_names']) ? (b['tag_names'] as string[]) : [],
      dateAdded: String(b['date_added'] ?? new Date().toISOString()),
    }))
  );
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html;charset=UTF-8',
      'Content-Disposition': 'attachment; filename="nodewarden-links-bookmarks.html"',
    },
  });
}

// --- Import handlers ---

export async function handleLinksImportJson(
  request: Request,
  env: Env,
  userId: string,
  url: URL
): Promise<Response> {
  const preview = url.searchParams.get('preview') === '1' || url.searchParams.get('preview') === 'true';
  const { raw, parseError } = await readJsonImportBody(request);
  if (parseError || raw === null || raw === undefined) {
    return jsonResponse({ detail: 'Invalid JSON backup file.' }, 400);
  }
  // A raw string here means the multipart/file text was not JSON.
  if (typeof raw === 'string') return jsonResponse({ detail: 'Invalid JSON backup file.' }, 400);
  const entries = toImportEntries(raw);
  const counts = await computeLinksImportPreview(env, userId, entries);
  if (preview) return jsonResponse({ ...counts, preview: true });
  const applied = await applyLinksImportEntries(env, userId, entries);
  await restoreBundlesAndProfile(env, userId, raw);
  return jsonResponse({ ok: true, ...applied });
}

export async function handleLinksImportHtml(
  request: Request,
  env: Env,
  userId: string,
  url: URL
): Promise<Response> {
  const preview = url.searchParams.get('preview') === '1' || url.searchParams.get('preview') === 'true';
  const text = await readHtmlImportText(request);
  if (!text) return jsonResponse({ detail: 'No HTML file provided.' }, 400);
  const parsed = parseNetscape(text);
  const entries = netscapeEntriesToImport(parsed);
  const counts = await computeLinksImportPreview(env, userId, entries);
  if (preview) return jsonResponse({ ...counts, preview: true });
  const applied = await applyLinksImportEntries(env, userId, entries);
  return jsonResponse({ ok: true, ...applied });
}
