// Small display helpers for the Links UI.

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

export function displayLinksUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return u.hostname + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return raw;
  }
}
