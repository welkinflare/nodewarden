// Unit assertions for the Links search-table mapping.
// src/linkding/search.ts emits SQL fragments with hardcoded `bookmarks` /
// `tags` / `bookmark_tags` table names; LinksStorage remaps them to the
// link_* tables (remapSearchTables) and builds bundle ORDER BY / filter
// clauses directly against link_* names. Run:
//   npx tsx --test scripts/links-search-mapping.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/linkding/search';
import {
  buildLinksListFilterClause,
  remapSearchTables,
  resolveLinksBookmarkOrderBy,
} from '../src/services/links-storage';

// Original linkding table references must be gone from a remapped plan,
// while correlation aliases (bt0/t0/...) stay untouched.
function assertRemapped(sql: string): void {
  assert.match(sql, /link_bookmark_tags/, 'link_bookmark_tags present');
  assert.match(sql, /link_tags/, 'link_tags present');
  assert.match(sql, /link_bookmarks/, 'link_bookmarks present');
  assert.doesNotMatch(sql, /FROM bookmark_tags/, 'no bare bookmark_tags table');
  assert.doesNotMatch(sql, /JOIN tags /, 'no bare tags table');
  // Bare `bookmarks.` refs (not preceded by `link_`): the lookbehind keeps
  // `link_bookmarks.id` legal while catching unmapped `bookmarks.id`.
  assert.doesNotMatch(sql, /(?<![_a-zA-Z])bookmarks\./, 'no bare bookmarks column ref');
  assert.doesNotMatch(sql, /(?<![_a-zA-Z])bookmark_tags/, 'no bare bookmark_tags ref');
  assert.doesNotMatch(sql, /(?<![_a-zA-Z])tags\./, 'no bare tags column ref');
}

test('strict tag + text query remaps tables, keeps aliases', () => {
  const plan = parseQuery('#work hello', { tag_search: 'strict' });
  const where = remapSearchTables(plan.where);
  assertRemapped(where);
  assert.match(where, /bt0/, 'bookmark_tags alias kept');
  assert.match(where, /t0/, 'tags alias kept');
  assert.match(where, /t0\.name = \?/, 'strict tag condition intact');
});

test('loose tag + exclusion + OR query remaps tables', () => {
  const plan = parseQuery('!#draft "multi word" OR #rust -obsolete', { tag_search: 'loose' });
  const where = remapSearchTables(plan.where);
  assertRemapped(where);
  assert.match(where, /LIKE \? ESCAPE/, 'loose LIKE + ESCAPE intact');
  assert.match(where, /NOT \(/, 'negation intact');
  assert.match(where, / OR /, 'OR group intact');
});

test('empty query stays 1=1 after remap', () => {
  const plan = parseQuery('', { tag_search: 'strict' });
  assert.equal(remapSearchTables(plan.where), '1=1');
  assert.equal(remapSearchTables(plan.joins), '');
});

test('bundle filter clause uses link_* names directly', () => {
  const { where, params } = buildLinksListFilterClause({
    modifiedSince: '2026-01-01T00:00:00.000Z',
    addedSince: 'not-a-date',
    bundle: {
      id: 'b1',
      user_id: 'u1',
      name: 'b',
      search: 'docs',
      any_tags: 'work, productivity',
      all_tags: 'rust',
      excluded_tags: 'draft',
      filter_unread: 1,
      filter_shared: 0,
      order: '',
      date_created: '',
      date_modified: '',
    },
    order: null,
  });
  assert.match(where, /link_bookmarks\.date_modified > \?/, 'modified_since on link_ table');
  assert.match(where, /link_bookmark_tags bt_any/, 'any-tags subquery on link_ tables');
  assert.match(where, /link_tags t_any/, 'any-tags join on link_tags');
  assert.match(where, /bt_all0/, 'all-tags alias kept');
  assert.match(where, /NOT EXISTS/, 'excluded-tags NOTed');
  assert.match(where, /link_bookmarks\.unread = 1/, 'unread filter on link_ table');
  assert.doesNotMatch(where, /FROM bookmark_tags/, 'no bare table leak');
  // docs(4 LIKE binds) + any(2) + all(1) + excluded(1) + modified(1).
  assert.equal(params.length, 4 + 2 + 1 + 1 + 1);
});

test('order-by allowlist: known keys map to link_ columns, unknown falls back', () => {
  for (const key of ['added_asc', '-added', 'modified_desc', 'date_modified', '+title', 'title_desc']) {
    const orderBy = resolveLinksBookmarkOrderBy(key);
    assert.match(orderBy, /link_bookmarks\./, `${key} targets link_bookmarks`);
    assert.doesNotMatch(orderBy, /;/, `${key} has no statement break`);
  }
  assert.equal(
    resolveLinksBookmarkOrderBy('date_added DESC; DROP TABLE link_bookmarks;--'),
    'link_bookmarks.date_added DESC, link_bookmarks.id DESC',
    'injection falls back to default order'
  );
  assert.equal(
    resolveLinksBookmarkOrderBy(null),
    'link_bookmarks.date_added DESC, link_bookmarks.id DESC',
    'null falls back to default order'
  );
});
