// Atom feed builder (linkding parity). Workers-only: pure string ops.
// The handler filters to the latest 50 entries within 30 days; this module
// only renders XML with strict escaping of all user-controlled content.

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  updated: string;
  published: string;
  description: string;
  tags: string[];
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildAtomFeed(input: {
  title: string;
  feedUrl: string;
  siteUrl: string;
  updated: string;
  entries: FeedEntry[];
}): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${escapeXml(input.title)}</title>`,
    `<link href="${escapeXml(input.siteUrl)}"/>`,
    `<link href="${escapeXml(input.feedUrl)}" rel="self"/>`,
    `<updated>${escapeXml(input.updated)}</updated>`,
    `<id>${escapeXml(input.feedUrl)}</id>`,
  ];
  for (const e of input.entries) {
    parts.push("<entry>");
    parts.push(`<title>${escapeXml(e.title || e.url)}</title>`);
    parts.push(`<link href="${escapeXml(e.url)}"/>`);
    parts.push(`<id>${escapeXml(e.id)}</id>`);
    parts.push(`<updated>${escapeXml(e.updated)}</updated>`);
    parts.push(`<published>${escapeXml(e.published)}</published>`);
    if (e.description) {
      parts.push(`<summary>${escapeXml(e.description)}</summary>`);
    }
    for (const tag of e.tags ?? []) {
      if (tag) parts.push(`<category term="${escapeXml(tag)}"/>`);
    }
    parts.push("</entry>");
  }
  parts.push("</feed>");
  return parts.join("\n");
}
