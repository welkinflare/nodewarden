// Netscape bookmark HTML codec (import/export parity).
// Workers-only: pure string ops, no DOM dependency, never throws.
// Build emits `<DT><A HREF+TAGS+ADD_DATE>` entries; parse recovers HREF,
// comma-split TAGS, ADD_DATE (unix seconds) -> ISO or now, and link text.

export interface NetscapeBookmarkInput {
  url: string;
  title: string;
  description: string;
  notes: string;
  tags: string[];
  dateAdded: string;
}

export interface NetscapeBookmarkOutput {
  url: string;
  title: string;
  description: string;
  notes?: string;
  tags: string[];
  dateAdded: string;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function addDateOf(dateAdded: string): number {
  const ms = Date.parse(dateAdded);
  return Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000);
}

// linkding's HTML export packs the bookmark notes onto the end of the <DD>
// description, wrapped in a literal "[linkding-notes]...[/linkding-notes]"
// marker pair, because the Netscape format has no notes field. Split it back
// out so imported bookmarks keep description and notes distinct. Mirrors
// linkding's own parser: split on the first open marker, cut notes at the
// first close marker (a missing closer takes the rest, like linkding).
export const LINKDING_NOTES_MARKER = '[linkding-notes]';
export const LINKDING_NOTES_CLOSE_MARKER = '[/linkding-notes]';

export function splitLinkdingNotes(description: string): { description: string; notes: string } {
  const at = description.indexOf(LINKDING_NOTES_MARKER);
  if (at < 0) return { description, notes: '' };
  const after = description.slice(at + LINKDING_NOTES_MARKER.length);
  const end = after.indexOf(LINKDING_NOTES_CLOSE_MARKER);
  const notes = (end < 0 ? after : after.slice(0, end)).trim();
  return { description: description.slice(0, at).trim(), notes };
}

// The Netscape format has no notes field, so linkding appends notes to the
// description behind a "[linkding-notes]...[/linkding-notes]" marker pair.
// Emit the same shape so our HTML export round-trips through linkding (and
// back into our importer) without losing notes. The pair is always emitted
// when notes exist — even with an empty description — so a notes-only
// bookmark does not come back as description text.
export function withNotes(description: string, notes: string): string {
  const trimmedNotes = notes.trim();
  if (!trimmedNotes) return description;
  return `${description.trim()}${LINKDING_NOTES_MARKER}${trimmedNotes}${LINKDING_NOTES_CLOSE_MARKER}`;
}

export function buildNetscape(bookmarks: NetscapeBookmarkOutput[]): string {
  const lines: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    "<DT><H3>Bookmarks</H3>",
    "<DL><p>",
  ];
  for (const b of bookmarks) {
    const tags = (b.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0);
    lines.push(
      `<DT><A HREF="${escapeAttr(b.url)}" ` +
        `ADD_DATE="${addDateOf(b.dateAdded)}" ` +
        `TAGS="${escapeAttr(tags.join(","))}">${escapeText(b.title || b.url)}</A>`,
    );
    const combined = withNotes(b.description, b.notes ?? '');
    if (combined) {
      lines.push(`<DD>${escapeText(combined)}</DD>`);
    }
  }
  lines.push("</DL><p>", "</DL><p>");
  return lines.join("\n");
}

function parseAttr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(
    tag,
  );
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

export function parseNetscape(html: string): NetscapeBookmarkInput[] {
  const out: NetscapeBookmarkInput[] = [];
  try {
    const anchorRe = /<A\s[^>]*>([\s\S]*?)<\/A\s*>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) !== null) {
      try {
        const openTag = m[0].slice(0, m[0].indexOf(">") + 1);
        const rawHref = parseAttr(openTag, "HREF");
        if (!rawHref) continue;
        const url = unescapeHtml(rawHref).trim();
        if (!url) continue;
        const rawTags = parseAttr(openTag, "TAGS") ?? "";
        const tags = unescapeHtml(rawTags)
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        const rawDate = parseAttr(openTag, "ADD_DATE");
        let dateAdded = new Date().toISOString();
        if (rawDate) {
          const n = Number(rawDate.trim());
          if (Number.isFinite(n) && n > 0) {
            // ADD_DATE is unix seconds; tolerate millis from loose exporters.
            const ms = n >= 1e12 ? n : n * 1000;
            const d = new Date(ms);
            if (!Number.isNaN(d.getTime())) dateAdded = d.toISOString();
          }
        }
        const title = unescapeHtml(
          m[1].replace(/<[^>]*>/g, "").trim(),
        );
        // Optional <DD>description</DD> (or bare <DD>text) after </A>.
        let rawDescription = "";
        const rest = html.slice(anchorRe.lastIndex);
        const dd = /^[\s\r\n]*<DD\s*>([\s\S]*?)(?:<\/DD\s*>|(?=<DT|<DL|\s*$))/i.exec(rest);
        if (dd) {
          rawDescription = unescapeHtml(dd[1].replace(/<[^>]*>/g, "").trim());
        }
        const { description, notes } = splitLinkdingNotes(rawDescription);
        out.push({ url, title: title || url, description, notes, tags, dateAdded });
      } catch {
        // Skip a single broken entry; keep importing the rest.
        continue;
      }
    }
  } catch {
    // Malformed input as a whole still returns what was parsed so far.
  }
  return out;
}
