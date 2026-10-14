// URL canonicalization for bookmarks (linkding parity).
// Canonical form: lowercased scheme+host, default ports dropped, trailing
// slash stripped (except the root, which is dropped entirely), utm_* query
// params removed, fragment dropped. Path case is preserved (only the host
// is lowered). Unparseable input passes through trimmed.

const UTM_PARAM = /^utm_/i;

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

// Bare domains pasted from address bars / chat apps ("www.google.com")
// carry no scheme, which `new URL()` rejects. Default those to https so
// the bookmark form accepts what users actually paste. Input that already
// has a scheme (including `javascript:`) is returned untouched so the
// protocol check in isValidHttpUrl still rejects it.
export function ensureHttpScheme(raw: unknown): string {
  const input = String(raw ?? '').trim();
  if (!input || SCHEME_RE.test(input)) return input;
  // Path-like input ("/docs", "\share") is not a bare domain: prepending a
  // scheme would turn it into a misleading host ("https://docs"), so leave
  // it for isValidHttpUrl to reject as before.
  if (input.startsWith('/') || input.startsWith('\\')) return input;
  return `https://${input}`;
}

export function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname !== '';
  } catch {
    return false;
  }
}

const DEFAULT_PORTS: Record<string, string> = {
  "http:": "80",
  "https:": "443",
};

export function normalizeUrl(u: string): string {
  const input = u.trim();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return input;
  }
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const port =
    parsed.port && parsed.port !== DEFAULT_PORTS[parsed.protocol]
      ? `:${parsed.port}`
      : "";
  let path = parsed.pathname;
  if (path === "/") {
    path = "";
  } else if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  const kept: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    if (!UTM_PARAM.test(key)) kept.push([key, value]);
  });
  const query = kept
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${scheme}//${host}${port}${path}${query ? `?${query}` : ""}`;
}
