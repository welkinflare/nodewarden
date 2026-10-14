// Small display helpers for the Links UI.

export const LINKDING_NOTES_MARKER = '[linkding-notes]';
const LINKDING_NOTES_CLOSE_MARKER = '[/linkding-notes]';

// Legacy linkding HTML imports packed notes onto the end of the description
// behind a "[linkding-notes]...[/linkding-notes]" marker pair (the Netscape
// format has no notes field). Split it back out for display so Description
// and Notes stay separate without needing a data migration. Mirrors linkding's
// own parser (split on the first open marker, cut at the first close marker)
// and src/linkding/netscape.ts on the backend.
export function splitLinkdingNotes(raw: string): { description: string; notes: string } {
  const text = String(raw ?? '');
  const at = text.indexOf(LINKDING_NOTES_MARKER);
  if (at < 0) return { description: text, notes: '' };
  const after = text.slice(at + LINKDING_NOTES_MARKER.length);
  const end = after.indexOf(LINKDING_NOTES_CLOSE_MARKER);
  const notes = (end < 0 ? after : after.slice(0, end)).trim();
  return { description: text.slice(0, at).trim(), notes };
}

export function formatLinksAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatLinksRelative(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diff = now - ms;
  if (diff < 0) return formatLinksAbsolute(iso);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  return `${Math.floor(mon / 12)}y ago`;
}

// Mirror of src/linkding/normalize.ts#ensureHttpScheme for the Links UI:
// default schemeless input ("www.google.com") to https so the bookmark
// form accepts what users actually paste. Anything that already has a
// scheme is returned untouched.
export function ensureLinksUrlScheme(raw: unknown): string {
  const input = String(raw ?? '').trim();
  if (!input || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) return input;
  if (input.startsWith('/') || input.startsWith('\\')) return input;
  return `https://${input}`;
}

export function displayLinksUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.hostname + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return raw;
  }
}
