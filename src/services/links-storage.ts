// Links (bookmarks) domain storage for nodewarden.
// Mirrors linkflare's StorageService bookmark/tag/bundle/profile/token/feed
// surface, adapted to nodewarden conventions:
// - All ids are TEXT UUIDs (generateUUID), userId is TEXT (users.id).
// - Tables are the link_* names from migrations/0002_links.sql.
// - D1 parameterized queries only; LIKE fragments always carry ESCAPE;
//   ORDER BY is allowlisted (resolveLinksBookmarkOrderBy).
// - Reads/writes are scoped by user_id; missing/foreign rows resolve to
//   null/false so handlers can answer with a generic 404 that never leaks
//   cross-user existence.
// - src/linkding/search.ts emits SQL fragments with hardcoded `bookmarks` /
//   `tags` / `bookmark_tags` table names; remapSearchTables() rewrites them
//   to the link_* names (see note on that function). Bundle filter clauses
//   and ORDER BY are built directly against link_* names.
// - Links never touches vault sync: no updateRevisionDate, no notifications,
//   no audit writes anywhere in this file.

import type { SqlPlan } from '../linkding/search';
import { generateUUID } from '../utils/uuid';

export interface LinkBookmarkRow {
  id: string;
  user_id: string;
  url: string;
  url_normalized: string;
  title: string;
  description: string;
  notes: string;
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

export interface LinkTagRow {
  id: string;
  user_id: string;
  name: string;
  date_added: string;
}

export interface LinkProfileRow {
  user_id: string;
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
}

export interface LinkBundleRow {
  id: string;
  user_id: string;
  name: string;
  search: string;
  any_tags: string;
  all_tags: string;
  excluded_tags: string;
  filter_unread: number;
  filter_shared: number;
  order: string;
  date_created: string;
  date_modified: string;
}

export interface LinkApiTokenRow {
  id: string;
  user_id: string;
  key: string;
  name: string;
  created: string;
}

export interface LinkFeedTokenRow {
  key: string;
  user_id: string;
  created: string;
}

// Defaults seeded for every new link_profile row (linkding parity).
export const DEFAULT_LINKS_PROFILE = {
  theme: 'auto',
  bookmark_date_display: 'relative',
  bookmark_link_target: '_blank',
  web_archive_integration: 'disabled',
  tag_search: 'strict',
  enable_sharing: 0,
  enable_public_sharing: 0,
  enable_favicons: 1,
  display_url: 0,
  permanent_notes: 0,
  search_preferences: '{}',
  auto_tagging_rules: '',
  items_per_page: 30,
  legacy_search: 0,
  custom_css: '',
};

// Linkding REST list filters. All fields optional so callers without
// filters keep working. `order` accepts linkding `sort` values plus `order`
// aliases (`-added`, `+title`, `date_modified`, ...); unknown values fall
// back to newest-first. Dates are ISO 8601; unparseable values are ignored.
export interface LinksBookmarkListFilters {
  modifiedSince?: string | null;
  addedSince?: string | null;
  bundle?: LinkBundleRow | null;
  order?: string | null;
}

// Rewrites table names emitted by src/linkding/search.ts (`bookmarks`,
// `tags`, `bookmark_tags`) to the link_* tables used by this service.
// Replacement order matters: `bookmark_tags` first (it contains neither a
// standalone `tags` nor `bookmarks` word, but replacing `tags` first would
// rewrite the tail of `bookmark_tags` into `bookmark_link_tags`), then
// standalone `tags`, then standalone `bookmarks`. Word boundaries (\b treat
// `_` as a word char) keep correlation aliases (bt0/t0/bt_any/t_any/...) and
// the already-prefixed link_* names untouched:
// - `bookmark_tags bt0` -> `link_bookmark_tags bt0`
// - `JOIN tags t0` -> `JOIN link_tags t0` (alias `t0` has no `tags` word)
// - `bookmarks.title` -> `link_bookmarks.title`
// - `link_bookmarks` itself is untouched (`_` before `bookmarks` blocks \b).
export function remapSearchTables(sql: string): string {
  return sql
    .replace(/\bbookmark_tags\b/g, 'link_bookmark_tags')
    .replace(/\btags\b/g, 'link_tags')
    .replace(/\bbookmarks\b/g, 'link_bookmarks');
}

// Allowlisted ORDER BY (no user input interpolated). Supports linkding
// `sort` values (added_asc/desc, modified_asc/desc, title_asc/desc) plus
// `order` aliases (`-added`, `+title`, `date_added`, `-date_modified`).
// Title sorts use the resolved title (title or url fallback) like linkding.
export function resolveLinksBookmarkOrderBy(order?: string | null): string {
  const key = String(order ?? '').trim().toLowerCase();
  const b = 'link_bookmarks';
  const titleAsc =
    `CASE WHEN ${b}.title IS NOT NULL AND ${b}.title != '' ` +
    `THEN ${b}.title ELSE ${b}.url END COLLATE NOCASE ASC, ${b}.id ASC`;
  const titleDesc =
    `CASE WHEN ${b}.title IS NOT NULL AND ${b}.title != '' ` +
    `THEN ${b}.title ELSE ${b}.url END COLLATE NOCASE DESC, ${b}.id DESC`;
  switch (key) {
    case 'added_asc':
    case 'date_added_asc':
    case 'added':
    case 'date_added':
    case '+added':
    case '+date_added':
      return `${b}.date_added ASC, ${b}.id ASC`;
    case 'added_desc':
    case 'date_added_desc':
    case '-added':
    case '-date_added':
      return `${b}.date_added DESC, ${b}.id DESC`;
    case 'modified_asc':
    case 'date_modified_asc':
    case 'modified':
    case 'date_modified':
    case '+modified':
    case '+date_modified':
      return `${b}.date_modified ASC, ${b}.id ASC`;
    case 'modified_desc':
    case 'date_modified_desc':
    case '-modified':
    case '-date_modified':
    case '+modified_desc':
      return `${b}.date_modified DESC, ${b}.id DESC`;
    case 'title_asc':
    case 'title':
    case '+title':
      return titleAsc;
    case 'title_desc':
    case '-title':
      return titleDesc;
    default:
      return `${b}.date_added DESC, ${b}.id DESC`;
  }
}

function normalizeDateFilter(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function splitBundleTags(raw: string): string[] {
  // Stored comma-separated by our bundles handler, but linkding docs show
  // space-separated (`any_tags: "work productivity"`). Accept both.
  return String(raw ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Builds the extra WHERE fragment for modified_since / added_since /
// bundle. Bundle semantics mirror linkding queries._filter_bundle: text
// terms ANDed, any_tags ORed, all_tags each ANDed, excluded_tags NOTed,
// filter_unread/shared (0=all, 1=only). Exported for unit testing.
export function buildLinksListFilterClause(
  filters?: LinksBookmarkListFilters | null
): { where: string; params: unknown[] } {
  if (!filters) return { where: '', params: [] };
  const b = 'link_bookmarks';
  const parts: string[] = [];
  const params: unknown[] = [];
  const modified = normalizeDateFilter(filters.modifiedSince);
  if (modified) {
    parts.push(`${b}.date_modified > ?`);
    params.push(modified);
  }
  const added = normalizeDateFilter(filters.addedSince);
  if (added) {
    parts.push(`${b}.date_added > ?`);
    params.push(added);
  }
  const bundle = filters.bundle;
  if (bundle) {
    const bparts: string[] = [];
    const searchTerms = String(bundle.search ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#') && !s.startsWith('!'));
    for (const term of searchTerms) {
      const pattern = `%${escapeLikePattern(term)}%`;
      bparts.push(
        `(${b}.title LIKE ? ESCAPE '\\' ` +
          `OR ${b}.description LIKE ? ESCAPE '\\' ` +
          `OR ${b}.url LIKE ? ESCAPE '\\' ` +
          `OR ${b}.notes LIKE ? ESCAPE '\\')`
      );
      params.push(pattern, pattern, pattern, pattern);
    }
    const anyTags = splitBundleTags(bundle.any_tags);
    if (anyTags.length > 0) {
      const conds = anyTags.map(() => `t_any.name = ?`).join(' OR ');
      bparts.push(
        `EXISTS (SELECT 1 FROM link_bookmark_tags bt_any ` +
          `JOIN link_tags t_any ON t_any.id = bt_any.tag_id ` +
          `WHERE bt_any.bookmark_id = ${b}.id ` +
          `AND t_any.user_id = ${b}.user_id AND (${conds}))`
      );
      params.push(...anyTags);
    }
    splitBundleTags(bundle.all_tags).forEach((tag, i) => {
      bparts.push(
        `EXISTS (SELECT 1 FROM link_bookmark_tags bt_all${i} ` +
          `JOIN link_tags t_all${i} ON t_all${i}.id = bt_all${i}.tag_id ` +
          `WHERE bt_all${i}.bookmark_id = ${b}.id ` +
          `AND t_all${i}.user_id = ${b}.user_id AND t_all${i}.name = ?)`
      );
      params.push(tag);
    });
    const excludedTags = splitBundleTags(bundle.excluded_tags);
    if (excludedTags.length > 0) {
      const conds = excludedTags.map(() => `t_ex.name = ?`).join(' OR ');
      bparts.push(
        `NOT EXISTS (SELECT 1 FROM link_bookmark_tags bt_ex ` +
          `JOIN link_tags t_ex ON t_ex.id = bt_ex.tag_id ` +
          `WHERE bt_ex.bookmark_id = ${b}.id ` +
          `AND t_ex.user_id = ${b}.user_id AND (${conds}))`
      );
      params.push(...excludedTags);
    }
    if (Number(bundle.filter_unread) === 1) {
      bparts.push(`${b}.unread = 1`);
    }
    if (Number(bundle.filter_shared) === 1) {
      bparts.push(`${b}.shared = 1`);
    }
    if (bparts.length > 0) {
      parts.push(`(${bparts.join(' AND ')})`);
    }
  }
  if (parts.length === 0) return { where: '', params: [] };
  return { where: ` AND (${parts.join(' AND ')})`, params };
}

// True for SQLite/D1 unique-constraint failures across implementations:
// D1 surfaces "UNIQUE constraint failed" in the message.
export function isLinksUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code ?? '');
  const message = String((err as { message?: unknown }).message ?? '');
  return /UNIQUE/i.test(code) || /UNIQUE constraint failed/i.test(message);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function cleanIdList(ids: string[]): string[] {
  return [...new Set(ids.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0 && v.length <= 64))];
}

export class LinksStorage {
  constructor(private db: D1Database) {}

  // D1 .bind() throws on `undefined`. Every value bound in this file is
  // coerced at the call site (`?? null`/defaults); patch builders skip
  // `undefined` entries outright.

  // --- User access (for token auth + feed auth + admin-gated export) ---

  async getUserAccess(userId: string): Promise<{ id: string; active: boolean; isAdmin: boolean } | null> {
    const row = await this.db
      .prepare('SELECT id, status, role FROM users WHERE id = ?')
      .bind(userId)
      .first<{ id: string; status: string; role: string }>();
    if (!row) return null;
    return { id: row.id, active: row.status === 'active', isAdmin: row.role === 'admin' };
  }

  // --- Profile ---

  async ensureLinksProfile(userId: string): Promise<void> {
    const p = DEFAULT_LINKS_PROFILE;
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO link_profile
         (user_id, theme, bookmark_date_display, bookmark_link_target,
          web_archive_integration, tag_search, enable_sharing,
          enable_public_sharing, enable_favicons, display_url,
          permanent_notes, search_preferences, auto_tagging_rules,
          items_per_page, legacy_search, custom_css)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        p.theme,
        p.bookmark_date_display,
        p.bookmark_link_target,
        p.web_archive_integration,
        p.tag_search,
        p.enable_sharing,
        p.enable_public_sharing,
        p.enable_favicons,
        p.display_url,
        p.permanent_notes,
        p.search_preferences,
        p.auto_tagging_rules,
        p.items_per_page,
        p.legacy_search,
        p.custom_css
      )
      .run();
  }

  async getLinksProfile(userId: string): Promise<LinkProfileRow | null> {
    return this.db
      .prepare('SELECT * FROM link_profile WHERE user_id = ?')
      .bind(userId)
      .first<LinkProfileRow>();
  }

  private static readonly PROFILE_PATCH_COLUMNS: ReadonlySet<string> = new Set([
    'theme',
    'bookmark_date_display',
    'bookmark_link_target',
    'web_archive_integration',
    'tag_search',
    'enable_sharing',
    'enable_public_sharing',
    'enable_favicons',
    'display_url',
    'permanent_notes',
    'search_preferences',
    'auto_tagging_rules',
    'items_per_page',
    'legacy_search',
    'custom_css',
  ]);

  async updateLinksProfile(userId: string, patch: Record<string, unknown>): Promise<LinkProfileRow | null> {
    await this.ensureLinksProfile(userId);
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [col, value] of Object.entries(patch)) {
      if (!LinksStorage.PROFILE_PATCH_COLUMNS.has(col)) continue;
      if (value === undefined) continue;
      sets.push(`${col} = ?`);
      args.push(value);
    }
    if (sets.length > 0) {
      await this.db
        .prepare(`UPDATE link_profile SET ${sets.join(', ')} WHERE user_id = ?`)
        .bind(...args, userId)
        .run();
    }
    return this.getLinksProfile(userId);
  }

  // --- Bookmarks core. Every statement carries user_id (column filter, or
  // the tag EXISTS correlation on link_tags.user_id = link_bookmarks.user_id
  // built by parseQuery + remapSearchTables). ---

  async getBookmarkById(userId: string, id: string): Promise<LinkBookmarkRow | null> {
    return this.db
      .prepare('SELECT * FROM link_bookmarks WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<LinkBookmarkRow>();
  }

  async getBookmarkByNormalized(userId: string, normalized: string): Promise<LinkBookmarkRow | null> {
    return this.db
      .prepare('SELECT * FROM link_bookmarks WHERE user_id = ? AND url_normalized = ?')
      .bind(userId, normalized)
      .first<LinkBookmarkRow>();
  }

  async createBookmark(input: {
    userId: string;
    url: string;
    urlNormalized: string;
    title: string;
    description: string;
    notes: string;
    unread: number;
    isArchived: number;
    shared: number;
    webArchiveSnapshotUrl: string;
    faviconUrl: string;
    previewImageUrl: string;
    now: string;
  }): Promise<LinkBookmarkRow> {
    const id = generateUUID();
    await this.db
      .prepare(
        `INSERT INTO link_bookmarks
         (id, user_id, url, url_normalized, title, description, notes,
          unread, is_archived, shared, web_archive_snapshot_url,
          favicon_url, preview_image_url,
          date_added, date_modified, date_accessed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.userId,
        input.url,
        input.urlNormalized,
        input.title,
        input.description,
        input.notes,
        input.unread,
        input.isArchived,
        input.shared,
        input.webArchiveSnapshotUrl,
        input.faviconUrl,
        input.previewImageUrl,
        input.now,
        input.now,
        ''
      )
      .run();
    // Re-read scoped by user_id (never trust the insert echo for ownership).
    const row = await this.getBookmarkById(input.userId, id);
    if (row) return row;
    // Extremely defensive: fall back to the normalized lookup (covers a
    // theoretical insert path that ignored our generated id).
    const fallback = await this.getBookmarkByNormalized(input.userId, input.urlNormalized);
    if (!fallback) throw new Error('Failed to create bookmark.');
    return fallback;
  }

  private static readonly BOOKMARK_PATCH_COLUMNS: ReadonlySet<string> = new Set([
    'url',
    'url_normalized',
    'title',
    'description',
    'notes',
    'unread',
    'is_archived',
    'shared',
    'web_archive_snapshot_url',
    'favicon_url',
    'preview_image_url',
    'date_modified',
    'date_accessed',
  ]);

  async updateBookmark(
    userId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<LinkBookmarkRow | null> {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [col, value] of Object.entries(patch)) {
      if (!LinksStorage.BOOKMARK_PATCH_COLUMNS.has(col)) continue;
      if (value === undefined) continue;
      sets.push(`${col} = ?`);
      args.push(value);
    }
    if (sets.length > 0) {
      await this.db
        .prepare(`UPDATE link_bookmarks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
        .bind(...args, id, userId)
        .run();
    }
    return this.getBookmarkById(userId, id);
  }

  async deleteBookmark(userId: string, id: string): Promise<boolean> {
    await this.db
      .prepare(
        'DELETE FROM link_bookmark_tags WHERE bookmark_id IN (SELECT id FROM link_bookmarks WHERE id = ? AND user_id = ?)'
      )
      .bind(id, userId)
      .run();
    const res = await this.db
      .prepare('DELETE FROM link_bookmarks WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return Number(res.meta?.changes ?? 0) > 0;
  }

  async countBookmarks(
    userId: string,
    plan: SqlPlan,
    archived: boolean,
    filters?: LinksBookmarkListFilters
  ): Promise<number> {
    const where = remapSearchTables(plan.where);
    const joins = remapSearchTables(plan.joins);
    const extra = buildLinksListFilterClause(filters);
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM link_bookmarks ${joins} ` +
          `WHERE link_bookmarks.user_id = ? AND link_bookmarks.is_archived = ? AND (${where})${extra.where}`
      )
      .bind(userId, archived ? 1 : 0, ...plan.params, ...extra.params)
      .first<{ n: number }>();
    return row ? Number(row.n) : 0;
  }

  async searchBookmarks(
    userId: string,
    plan: SqlPlan,
    opts: { limit: number; offset: number; archived: boolean } & LinksBookmarkListFilters
  ): Promise<LinkBookmarkRow[]> {
    const where = remapSearchTables(plan.where);
    const joins = remapSearchTables(plan.joins);
    const extra = buildLinksListFilterClause(opts);
    const orderBy = resolveLinksBookmarkOrderBy(opts.order);
    const { results } = await this.db
      .prepare(
        `SELECT link_bookmarks.* FROM link_bookmarks ${joins} ` +
          `WHERE link_bookmarks.user_id = ? AND link_bookmarks.is_archived = ? AND (${where})${extra.where} ` +
          `ORDER BY ${orderBy} LIMIT ? OFFSET ?`
      )
      .bind(
        userId,
        opts.archived ? 1 : 0,
        ...plan.params,
        ...extra.params,
        opts.limit,
        opts.offset
      )
      .all<LinkBookmarkRow>();
    return (results ?? []) as LinkBookmarkRow[];
  }

  // Full user export helper (backup). Ordered by id for stable output.
  async listAllBookmarks(userId: string): Promise<LinkBookmarkRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM link_bookmarks WHERE user_id = ? ORDER BY id')
      .bind(userId)
      .all<LinkBookmarkRow>();
    return (results ?? []) as LinkBookmarkRow[];
  }

  // Ensures one tag row per name for the user (NOCASE unique) and returns
  // the rows. Names are trimmed and deduped case-insensitively.
  async ensureTags(userId: string, names: string[], now: string): Promise<LinkTagRow[]> {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const raw of names) {
      const name = String(raw ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(name);
    }
    for (const name of unique) {
      await this.db
        .prepare('INSERT OR IGNORE INTO link_tags (id, user_id, name, date_added) VALUES (?, ?, ?, ?)')
        .bind(generateUUID(), userId, name, now)
        .run();
    }
    if (unique.length === 0) return [];
    // Chunk the IN list to stay under the D1 bind-variable limit.
    const out: LinkTagRow[] = [];
    for (const slice of chunk(unique, 40)) {
      const placeholders = slice.map(() => '?').join(', ');
      const { results } = await this.db
        .prepare(
          `SELECT * FROM link_tags WHERE user_id = ? AND name COLLATE NOCASE IN (${placeholders})`
        )
        .bind(userId, ...slice)
        .all<LinkTagRow>();
      out.push(...((results ?? []) as LinkTagRow[]));
    }
    return out;
  }

  // Replaces all tag links of a bookmark in one batch. Scoped by user_id:
  // links are only touched when the bookmark belongs to the user, otherwise
  // this is a silent no-op (all callers pre-check ownership; this is
  // defense-in-depth so a caller bug can never rewrite foreign links).
  async setBookmarkTagLinks(userId: string, bookmarkId: string, tagIds: string[]): Promise<void> {
    const owner = await this.db
      .prepare('SELECT id FROM link_bookmarks WHERE id = ? AND user_id = ?')
      .bind(bookmarkId, userId)
      .first<{ id: string }>();
    if (!owner) return;
    const stmts = [
      this.db
        .prepare(
          'DELETE FROM link_bookmark_tags WHERE bookmark_id IN (SELECT id FROM link_bookmarks WHERE id = ? AND user_id = ?)'
        )
        .bind(bookmarkId, userId),
    ];
    for (const tagId of tagIds) {
      stmts.push(
        this.db
          .prepare('INSERT OR IGNORE INTO link_bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')
          .bind(bookmarkId, tagId)
      );
    }
    await this.db.batch(stmts);
  }

  async getTagNamesForBookmarks(userId: string, bookmarkIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    const clean = cleanIdList(bookmarkIds);
    if (clean.length === 0) return map;
    for (const slice of chunk(clean, 50)) {
      const placeholders = slice.map(() => '?').join(', ');
      const { results } = await this.db
        .prepare(
          `SELECT bt.bookmark_id AS bookmark_id, t.name AS name
           FROM link_bookmark_tags bt JOIN link_tags t ON t.id = bt.tag_id
           WHERE t.user_id = ? AND bt.bookmark_id IN (${placeholders})`
        )
        .bind(userId, ...slice)
        .all<{ bookmark_id: string; name: string }>();
      for (const row of (results ?? []) as Array<{ bookmark_id: string; name: string }>) {
        const list = map.get(row.bookmark_id) ?? [];
        list.push(row.name);
        map.set(row.bookmark_id, list);
      }
    }
    return map;
  }

  // Narrows arbitrary ids to rows owned by the user.
  async findOwnedBookmarkIds(userId: string, ids: string[]): Promise<string[]> {
    const clean = cleanIdList(ids);
    if (clean.length === 0) return [];
    const out: string[] = [];
    for (const slice of chunk(clean, 50)) {
      const placeholders = slice.map(() => '?').join(', ');
      const { results } = await this.db
        .prepare(`SELECT id FROM link_bookmarks WHERE user_id = ? AND id IN (${placeholders})`)
        .bind(userId, ...slice)
        .all<{ id: string }>();
      for (const r of (results ?? []) as Array<{ id: string }>) out.push(r.id);
    }
    return out;
  }

  // --- Bulk operations. Each chunk runs as a single D1 batch and only
  // touches rows owned by the user. Returns the owned-row count. ---

  async bulkSetArchived(userId: string, ids: string[], archived: boolean): Promise<number> {
    const owned = await this.findOwnedBookmarkIds(userId, ids);
    if (owned.length === 0) return 0;
    const now = new Date().toISOString();
    for (const slice of chunk(owned, 40)) {
      const placeholders = slice.map(() => '?').join(', ');
      await this.db
        .prepare(
          `UPDATE link_bookmarks SET is_archived = ?, date_modified = ? WHERE user_id = ? AND id IN (${placeholders})`
        )
        .bind(archived ? 1 : 0, now, userId, ...slice)
        .run();
    }
    return owned.length;
  }

  async bulkSetUnread(userId: string, ids: string[], unread: boolean): Promise<number> {
    const owned = await this.findOwnedBookmarkIds(userId, ids);
    if (owned.length === 0) return 0;
    const now = new Date().toISOString();
    for (const slice of chunk(owned, 40)) {
      const placeholders = slice.map(() => '?').join(', ');
      await this.db
        .prepare(
          `UPDATE link_bookmarks SET unread = ?, date_modified = ? WHERE user_id = ? AND id IN (${placeholders})`
        )
        .bind(unread ? 1 : 0, now, userId, ...slice)
        .run();
    }
    return owned.length;
  }

  async bulkDelete(userId: string, ids: string[]): Promise<number> {
    const owned = await this.findOwnedBookmarkIds(userId, ids);
    if (owned.length === 0) return 0;
    for (const slice of chunk(owned, 40)) {
      const placeholders = slice.map(() => '?').join(', ');
      await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM link_bookmark_tags WHERE bookmark_id IN (SELECT id FROM link_bookmarks WHERE user_id = ? AND id IN (${placeholders}))`
          )
          .bind(userId, ...slice),
        this.db
          .prepare(`DELETE FROM link_bookmarks WHERE user_id = ? AND id IN (${placeholders})`)
          .bind(userId, ...slice),
      ]);
    }
    return owned.length;
  }

  async bulkAddTags(userId: string, ids: string[], names: string[], now: string): Promise<number> {
    const owned = await this.findOwnedBookmarkIds(userId, ids);
    if (owned.length === 0) return 0;
    const tags = await this.ensureTags(userId, names, now);
    if (tags.length === 0) return 0;
    for (const slice of chunk(owned, 40)) {
      const stmts = tags.flatMap((tag) =>
        slice.map((bookmarkId) =>
          this.db
            .prepare('INSERT OR IGNORE INTO link_bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')
            .bind(bookmarkId, tag.id)
        )
      );
      await this.db.batch(stmts);
    }
    return owned.length;
  }

  async bulkRemoveTags(userId: string, ids: string[], names: string[]): Promise<number> {
    const owned = await this.findOwnedBookmarkIds(userId, ids);
    if (owned.length === 0) return 0;
    const lowered = [
      ...new Set(
        names
          .map((n) => String(n ?? '').trim().toLowerCase())
          .filter((n) => n.length > 0)
      ),
    ];
    if (lowered.length === 0) return 0;
    const tagPlaceholders = lowered.map(() => '?').join(', ');
    for (const slice of chunk(owned, 40)) {
      const idPlaceholders = slice.map(() => '?').join(', ');
      await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM link_bookmark_tags WHERE bookmark_id IN (${idPlaceholders}) ` +
              `AND tag_id IN (SELECT id FROM link_tags WHERE user_id = ? AND name COLLATE NOCASE IN (${tagPlaceholders}))`
          )
          .bind(...slice, userId, ...lowered),
      ]);
    }
    return owned.length;
  }

  // --- Tags. link_tags.name is UNIQUE(user_id, name) NOCASE; every
  // statement is scoped by user_id so foreign ids resolve to null/false. ---

  async listTags(userId: string): Promise<Array<LinkTagRow & { bookmark_count: number }>> {
    const { results } = await this.db
      .prepare(
        `SELECT t.*, COUNT(bt.bookmark_id) AS bookmark_count
         FROM link_tags t LEFT JOIN link_bookmark_tags bt ON bt.tag_id = t.id
         WHERE t.user_id = ?
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE`
      )
      .bind(userId)
      .all<LinkTagRow & { bookmark_count: number }>();
    return (results ?? []) as Array<LinkTagRow & { bookmark_count: number }>;
  }

  async getTagById(userId: string, id: string): Promise<LinkTagRow | null> {
    return this.db
      .prepare('SELECT * FROM link_tags WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<LinkTagRow>();
  }

  async findTagByName(userId: string, name: string): Promise<LinkTagRow | null> {
    // The column is COLLATE NOCASE, so `=` already matches case-insensitively.
    return this.db
      .prepare('SELECT * FROM link_tags WHERE user_id = ? AND name = ?')
      .bind(userId, name)
      .first<LinkTagRow>();
  }

  async createTag(userId: string, name: string, now: string): Promise<LinkTagRow> {
    const id = generateUUID();
    await this.db
      .prepare('INSERT INTO link_tags (id, user_id, name, date_added) VALUES (?, ?, ?, ?)')
      .bind(id, userId, name, now)
      .run();
    const row = await this.findTagByName(userId, name);
    if (!row) throw new Error('Failed to create tag.');
    return row;
  }

  async renameTag(userId: string, id: string, name: string): Promise<LinkTagRow | null> {
    await this.db
      .prepare('UPDATE link_tags SET name = ? WHERE id = ? AND user_id = ?')
      .bind(name, id, userId)
      .run();
    return this.getTagById(userId, id);
  }

  async deleteTag(userId: string, id: string): Promise<boolean> {
    const res = (await this.db.batch([
      this.db
        .prepare(
          'DELETE FROM link_bookmark_tags WHERE tag_id IN (SELECT id FROM link_tags WHERE id = ? AND user_id = ?)'
        )
        .bind(id, userId),
      this.db.prepare('DELETE FROM link_tags WHERE id = ? AND user_id = ?').bind(id, userId),
    ])) as unknown as Array<{ meta?: { changes?: unknown } }>;
    return Number(res[1]?.meta?.changes ?? 0) > 0;
  }

  // Merges sourceId into targetId in one batch: every bookmark linked to
  // the source gains the target link (OR IGNORE keeps the PK intact),
  // source links are removed, and the source tag row is deleted. Callers
  // must resolve both ids to owned rows first.
  async mergeTags(userId: string, sourceId: string, targetId: string): Promise<LinkTagRow | null> {
    await this.db.batch([
      this.db
        .prepare(
          'INSERT OR IGNORE INTO link_bookmark_tags (bookmark_id, tag_id) ' +
            'SELECT bookmark_id, ? FROM link_bookmark_tags WHERE tag_id = ?'
        )
        .bind(targetId, sourceId),
      this.db.prepare('DELETE FROM link_bookmark_tags WHERE tag_id = ?').bind(sourceId),
      this.db.prepare('DELETE FROM link_tags WHERE id = ? AND user_id = ?').bind(sourceId, userId),
    ]);
    return this.getTagById(userId, targetId);
  }

  // --- Bundles: saved searches, CRUD per user. ---

  async listBundles(userId: string): Promise<LinkBundleRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM link_bundles WHERE user_id = ? ORDER BY name COLLATE NOCASE')
      .bind(userId)
      .all<LinkBundleRow>();
    return (results ?? []) as LinkBundleRow[];
  }

  async getBundleById(userId: string, id: string): Promise<LinkBundleRow | null> {
    return this.db
      .prepare('SELECT * FROM link_bundles WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<LinkBundleRow>();
  }

  async createBundle(input: {
    userId: string;
    name: string;
    search: string;
    anyTags: string;
    allTags: string;
    excludedTags: string;
    filterUnread: number;
    filterShared: number;
    order: string;
    now: string;
  }): Promise<LinkBundleRow> {
    const id = generateUUID();
    await this.db
      .prepare(
        `INSERT INTO link_bundles
         (id, user_id, name, search, any_tags, all_tags, excluded_tags,
          filter_unread, filter_shared, "order", date_created, date_modified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        input.userId,
        input.name,
        input.search,
        input.anyTags,
        input.allTags,
        input.excludedTags,
        input.filterUnread,
        input.filterShared,
        input.order,
        input.now,
        input.now
      )
      .run();
    const row = await this.getBundleById(input.userId, id);
    if (!row) throw new Error('Failed to create bundle.');
    return row;
  }

  private static readonly BUNDLE_PATCH_COLUMNS: ReadonlySet<string> = new Set([
    'name',
    'search',
    'any_tags',
    'all_tags',
    'excluded_tags',
    'filter_unread',
    'filter_shared',
    'order',
    'date_modified',
  ]);

  async updateBundle(
    userId: string,
    id: string,
    patch: Record<string, unknown>
  ): Promise<LinkBundleRow | null> {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [col, value] of Object.entries(patch)) {
      if (!LinksStorage.BUNDLE_PATCH_COLUMNS.has(col)) continue;
      if (value === undefined) continue;
      sets.push(col === 'order' ? `"order" = ?` : `${col} = ?`);
      args.push(value);
    }
    if (sets.length > 0) {
      await this.db
        .prepare(`UPDATE link_bundles SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
        .bind(...args, id, userId)
        .run();
    }
    return this.getBundleById(userId, id);
  }

  async deleteBundle(userId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM link_bundles WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return Number(res.meta?.changes ?? 0) > 0;
  }

  // --- API tokens: one row per issued key (revocation is row deletion).
  // Feed tokens: single row per user (create-or-get). ---

  async listApiTokens(userId: string): Promise<LinkApiTokenRow[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM link_api_tokens WHERE user_id = ? ORDER BY created, id')
      .bind(userId)
      .all<LinkApiTokenRow>();
    return (results ?? []) as LinkApiTokenRow[];
  }

  async getApiTokenById(userId: string, id: string): Promise<LinkApiTokenRow | null> {
    return this.db
      .prepare('SELECT * FROM link_api_tokens WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<LinkApiTokenRow>();
  }

  async createApiToken(input: {
    userId: string;
    key: string;
    name: string;
    created: string;
  }): Promise<LinkApiTokenRow> {
    const id = generateUUID();
    await this.db
      .prepare('INSERT INTO link_api_tokens (id, user_id, key, name, created) VALUES (?, ?, ?, ?, ?)')
      .bind(id, input.userId, input.key, input.name, input.created)
      .run();
    const row = await this.db
      .prepare('SELECT * FROM link_api_tokens WHERE key = ?')
      .bind(input.key)
      .first<LinkApiTokenRow>();
    if (!row) throw new Error('Failed to create API token.');
    return row;
  }

  async deleteApiToken(userId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM link_api_tokens WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return Number(res.meta?.changes ?? 0) > 0;
  }

  async findUserIdByTokenKey(key: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT user_id FROM link_api_tokens WHERE key = ?')
      .bind(key)
      .first<{ user_id: string }>();
    return row ? row.user_id : null;
  }

  async getFeedToken(userId: string): Promise<LinkFeedTokenRow | null> {
    return this.db
      .prepare('SELECT * FROM link_feed_tokens WHERE user_id = ? ORDER BY created LIMIT 1')
      .bind(userId)
      .first<LinkFeedTokenRow>();
  }

  // Single feed token per user: returns the existing row, or inserts one.
  // On a concurrent double-create the earliest row wins and extras are
  // removed, so repeated calls converge on one stable key.
  async createOrGetFeedToken(userId: string, key: string, created: string): Promise<LinkFeedTokenRow> {
    const existing = await this.getFeedToken(userId);
    if (existing) return existing;
    try {
      await this.db
        .prepare('INSERT INTO link_feed_tokens (key, user_id, created) VALUES (?, ?, ?)')
        .bind(key, userId, created)
        .run();
    } catch (err) {
      // Lost a concurrent create race: fall through to the read below.
      if (!isLinksUniqueViolation(err)) throw err;
    }
    const { results } = await this.db
      .prepare('SELECT * FROM link_feed_tokens WHERE user_id = ? ORDER BY created')
      .bind(userId)
      .all<LinkFeedTokenRow>();
    const rows = (results ?? []) as LinkFeedTokenRow[];
    if (rows.length === 0) throw new Error('Failed to create feed token.');
    for (const extra of rows.slice(1)) {
      await this.db.prepare('DELETE FROM link_feed_tokens WHERE key = ?').bind(extra.key).run();
    }
    return rows[0];
  }

  async findFeedTokenUser(key: string): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT user_id FROM link_feed_tokens WHERE key = ?')
      .bind(key)
      .first<{ user_id: string }>();
    return row ? row.user_id : null;
  }

  // --- Feeds: latest 50 bookmarks from the last 30 days, newest first,
  // archived rows excluded. kind filters unread/shared on top. ---

  async getFeedBookmarks(
    userId: string,
    kind: 'all' | 'unread' | 'shared',
    limit = 50
  ): Promise<LinkBookmarkRow[]> {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    let sql = 'SELECT * FROM link_bookmarks WHERE user_id = ? AND is_archived = 0 AND date_added >= ?';
    const args: unknown[] = [userId, cutoff];
    if (kind === 'unread') sql += ' AND unread = 1';
    if (kind === 'shared') sql += ' AND shared = 1';
    sql += ' ORDER BY date_added DESC, id DESC LIMIT ?';
    args.push(limit);
    const { results } = await this.db.prepare(sql).bind(...args).all<LinkBookmarkRow>();
    return (results ?? []) as LinkBookmarkRow[];
  }
}
