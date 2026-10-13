// Atom feeds: GET /api/links/feeds/{all,unread,shared}.atom?token=.
// Auth is the per-user link_feed_tokens key (query param, never the
// session). Renders the latest 50 bookmarks from the last 30 days as Atom
// XML with all user content XML-escaped. Missing/invalid tokens (or a
// disabled/missing owning user) are a plain-text 401.

import type { Env } from '../../types';
import { LinksStorage } from '../../services/links-storage';
import { buildAtomFeed } from '../../linkding/feed';

export type LinksFeedKind = 'all' | 'unread' | 'shared';

function feedUnauthorized(): Response {
  return new Response('Authentication required.', {
    status: 401,
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
  });
}

export async function handleLinksFeed(
  request: Request,
  env: Env,
  url: URL,
  kind: LinksFeedKind
): Promise<Response> {
  void request;
  const token = (url.searchParams.get('token') ?? '').trim();
  if (!token) return feedUnauthorized();
  const store = new LinksStorage(env.DB);
  const userId = await store.findFeedTokenUser(token);
  if (!userId) return feedUnauthorized();
  const access = await store.getUserAccess(userId);
  if (!access || !access.active) return feedUnauthorized();

  const rows = await store.getFeedBookmarks(userId, kind);
  const tagsByBookmark = await store.getTagNamesForBookmarks(
    userId,
    rows.map((r) => r.id)
  );
  const origin = url.origin;
  const xml = buildAtomFeed({
    title: `nodewarden-links - ${kind}`,
    feedUrl: url.toString(),
    siteUrl: `${origin}/`,
    updated: new Date().toISOString(),
    entries: rows.map((row) => ({
      id: `${origin}/api/bookmarks/${row.id}`,
      title: row.title || row.url,
      url: row.url,
      updated: row.date_modified || row.date_added || new Date().toISOString(),
      published: row.date_added || new Date().toISOString(),
      description: row.description,
      tags: tagsByBookmark.get(row.id) ?? [],
    })),
  });
  return new Response(xml, {
    status: 200,
    headers: { 'content-type': 'application/atom+xml;charset=UTF-8' },
  });
}
