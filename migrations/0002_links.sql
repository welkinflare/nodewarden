-- Links (bookmarks) domain tables. All rows belong to a nodewarden user
-- (users.id TEXT); deletes cascade like ciphers/sends.
-- Keep in sync with src/services/storage-schema.ts (SCHEMA_STATEMENTS).

CREATE TABLE IF NOT EXISTS link_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  url_normalized TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  unread INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  shared INTEGER NOT NULL DEFAULT 0,
  web_archive_snapshot_url TEXT NOT NULL DEFAULT '',
  favicon_url TEXT NOT NULL DEFAULT '',
  preview_image_url TEXT NOT NULL DEFAULT '',
  date_added TEXT NOT NULL DEFAULT '',
  date_modified TEXT NOT NULL DEFAULT '',
  date_accessed TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, url_normalized),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_bookmarks_user_archived_date ON link_bookmarks(user_id, is_archived, date_added);

CREATE TABLE IF NOT EXISTS link_tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  date_added TEXT NOT NULL DEFAULT '',
  UNIQUE(user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_tags_user ON link_tags(user_id);

CREATE TABLE IF NOT EXISTS link_bookmark_tags (
  bookmark_id TEXT NOT NULL REFERENCES link_bookmarks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES link_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_link_bookmark_tags_tag ON link_bookmark_tags(tag_id);

CREATE TABLE IF NOT EXISTS link_bundles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  search TEXT NOT NULL DEFAULT '',
  any_tags TEXT NOT NULL DEFAULT '',
  all_tags TEXT NOT NULL DEFAULT '',
  excluded_tags TEXT NOT NULL DEFAULT '',
  filter_unread INTEGER NOT NULL DEFAULT 0,
  filter_shared INTEGER NOT NULL DEFAULT 0,
  "order" TEXT NOT NULL DEFAULT '',
  date_created TEXT NOT NULL DEFAULT '',
  date_modified TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_bundles_user ON link_bundles(user_id);

CREATE TABLE IF NOT EXISTS link_api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_api_tokens_user ON link_api_tokens(user_id);

CREATE TABLE IF NOT EXISTS link_feed_tokens (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_feed_tokens_user ON link_feed_tokens(user_id);

CREATE TABLE IF NOT EXISTS link_profile (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'auto',
  bookmark_date_display TEXT NOT NULL DEFAULT 'relative',
  bookmark_link_target TEXT NOT NULL DEFAULT '_blank',
  web_archive_integration TEXT NOT NULL DEFAULT 'disabled',
  tag_search TEXT NOT NULL DEFAULT 'strict',
  enable_sharing INTEGER NOT NULL DEFAULT 0,
  enable_public_sharing INTEGER NOT NULL DEFAULT 0,
  enable_favicons INTEGER NOT NULL DEFAULT 1,
  display_url INTEGER NOT NULL DEFAULT 0,
  permanent_notes INTEGER NOT NULL DEFAULT 0,
  search_preferences TEXT NOT NULL DEFAULT '{}',
  auto_tagging_rules TEXT NOT NULL DEFAULT '',
  items_per_page INTEGER NOT NULL DEFAULT 30,
  legacy_search INTEGER NOT NULL DEFAULT 0,
  custom_css TEXT NOT NULL DEFAULT ''
);
