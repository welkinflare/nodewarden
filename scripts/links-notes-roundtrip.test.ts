// Unit assertions for the linkding-notes marker round-trip and the new
// unread/shared/untagged list filters. Run:
//   npx tsx --test scripts/links-notes-roundtrip.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LINKDING_NOTES_CLOSE_MARKER,
  LINKDING_NOTES_MARKER,
  buildNetscape,
  parseNetscape,
  splitLinkdingNotes,
  withNotes,
} from '../src/linkding/netscape';
import { buildLinksListFilterClause } from '../src/services/links-storage';
import { sameOriginFaviconUrl } from '../src/handlers/links/bookmarks';

test('splitLinkdingNotes strips a paired marker', () => {
  const out = splitLinkdingNotes(
    `A description${LINKDING_NOTES_MARKER}**License**: MIT${LINKDING_NOTES_CLOSE_MARKER}`
  );
  assert.equal(out.description, 'A description');
  assert.equal(out.notes, '**License**: MIT');
});

test('splitLinkdingNotes tolerates a missing closer like linkding', () => {
  const out = splitLinkdingNotes(`desc${LINKDING_NOTES_MARKER}note text`);
  assert.equal(out.description, 'desc');
  assert.equal(out.notes, 'note text');
});

test('splitLinkdingNotes leaves plain text untouched', () => {
  const out = splitLinkdingNotes('Just a description.');
  assert.equal(out.description, 'Just a description.');
  assert.equal(out.notes, '');
});

test('withNotes always emits the marker pair when notes exist', () => {
  assert.equal(
    withNotes('desc', 'notes'),
    `desc${LINKDING_NOTES_MARKER}notes${LINKDING_NOTES_CLOSE_MARKER}`
  );
  // Notes-only bookmarks must not come back as description text.
  assert.equal(
    withNotes('', 'notes'),
    `${LINKDING_NOTES_MARKER}notes${LINKDING_NOTES_CLOSE_MARKER}`
  );
  assert.equal(withNotes('desc', '  '), 'desc');
});

test('netscape HTML round-trips notes through paired markers', () => {
  const html = buildNetscape([
    { url: 'https://example.com/a', title: 'A', description: 'Desc A', notes: 'Note A', tags: ['x'], dateAdded: new Date().toISOString() },
    { url: 'https://example.com/b', title: 'B', description: '', notes: 'Note B only', tags: [], dateAdded: new Date().toISOString() },
  ]);
  const parsed = parseNetscape(html);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].description, 'Desc A');
  assert.equal(parsed[0].notes, 'Note A');
  assert.equal(parsed[1].description, '');
  assert.equal(parsed[1].notes, 'Note B only');
});

test('real linkding exports parse without closer leakage', () => {
  const html = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<DL><p>',
    '<DT><A HREF="https://example.com/" ADD_DATE="1700000000" TAGS="x">T</A>',
    `<DD>Some desc${LINKDING_NOTES_MARKER}Some notes${LINKDING_NOTES_CLOSE_MARKER}</DD>`,
    '</DL><p>',
  ].join('\n');
  const [entry] = parseNetscape(html);
  assert.equal(entry.description, 'Some desc');
  assert.equal(entry.notes, 'Some notes');
});

test('unread/shared/untagged list filters emit SQL guards', () => {
  const unread = buildLinksListFilterClause({ unread: true });
  assert.match(unread.where, /link_bookmarks\.unread = 1/);
  assert.deepEqual(unread.params, []);
  const shared = buildLinksListFilterClause({ shared: true });
  assert.match(shared.where, /link_bookmarks\.shared = 1/);
  const untagged = buildLinksListFilterClause({ untagged: true });
  assert.match(untagged.where, /NOT EXISTS \(SELECT 1 FROM link_bookmark_tags/);
  const empty = buildLinksListFilterClause({});
  assert.equal(empty.where, '');
});

test('sameOriginFaviconUrl builds absolute proxy URLs', () => {
  assert.equal(
    sameOriginFaviconUrl('https://Example.COM/article', 'http://127.0.0.1:8787'),
    'http://127.0.0.1:8787/icons/example.com/icon.png'
  );
  assert.equal(sameOriginFaviconUrl('not a url', 'http://127.0.0.1:8787'), '');
  assert.equal(sameOriginFaviconUrl('https://example.com/', ''), '');
});
