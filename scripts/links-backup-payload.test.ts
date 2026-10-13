// Unit assertions for Links tables inside the instance-backup payload.
// Covers validateBackupPayloadContents() link_* validation in
// src/services/backup-archive.ts. Run:
//   npx tsx --test scripts/links-backup-payload.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupPayloadContents } from '../src/services/backup-archive';

function baseDb(): Record<string, unknown[]> {
  return {
    config: [],
    users: [{ id: 'u1', email: 'a@example.com' }],
    domain_settings: [],
    user_revisions: [],
    folders: [],
    ciphers: [],
    attachments: [],
    link_bookmarks: [
      { id: 'b1', user_id: 'u1', url: 'https://example.com', url_normalized: 'example.com' },
    ],
    link_tags: [{ id: 't1', user_id: 'u1', name: 'reading' }],
    link_bookmark_tags: [{ bookmark_id: 'b1', tag_id: 't1' }],
    link_bundles: [{ id: 's1', user_id: 'u1', name: 'Saved' }],
    link_api_tokens: [{ id: 'k1', user_id: 'u1', key: 'abc', name: 'ext', created: 'x' }],
    link_feed_tokens: [{ key: 'f1', user_id: 'u1', created: 'x' }],
    link_profile: [{ user_id: 'u1', theme: 'auto' }],
  };
}

function payloadWith(db: Record<string, unknown[]>) {
  return { manifest: {}, db } as never;
}

test('valid links payload passes validation', () => {
  assert.doesNotThrow(() => validateBackupPayloadContents(payloadWith(baseDb()), {}));
});

test('archive without link sections (pre-links) passes validation', () => {
  const { link_bookmarks, link_tags, link_bookmark_tags, link_bundles, link_api_tokens, link_feed_tokens, link_profile, ...rest } = baseDb();
  void link_bookmarks;
  void link_tags;
  void link_bookmark_tags;
  void link_bundles;
  void link_api_tokens;
  void link_feed_tokens;
  void link_profile;
  assert.doesNotThrow(() => validateBackupPayloadContents(payloadWith(rest), {}));
});

test('link bookmark for unknown user throws', () => {
  const db = baseDb();
  (db.link_bookmarks as Record<string, unknown>[])[0].user_id = 'ghost';
  assert.throws(() => validateBackupPayloadContents(payloadWith(db), {}), /invalid link bookmark row/);
});

test('duplicate link bookmark id throws', () => {
  const db = baseDb();
  (db.link_bookmarks as Record<string, unknown>[]).push({ id: 'b1', user_id: 'u1', url: 'https://x.test' });
  assert.throws(() => validateBackupPayloadContents(payloadWith(db), {}), /duplicate link bookmark id/);
});

test('bookmark-tag link to unknown tag throws', () => {
  const db = baseDb();
  (db.link_bookmark_tags as Record<string, unknown>[])[0].tag_id = 'nope';
  assert.throws(() => validateBackupPayloadContents(payloadWith(db), {}), /invalid link bookmark-tag row/);
});

test('duplicate link profile for user throws', () => {
  const db = baseDb();
  (db.link_profile as Record<string, unknown>[]).push({ user_id: 'u1', theme: 'dark' });
  assert.throws(() => validateBackupPayloadContents(payloadWith(db), {}), /duplicate link profile/);
});
