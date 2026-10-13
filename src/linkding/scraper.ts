// Metadata scraper (linkding parity, fail-soft).
// Fetches the page with an 8s abort timeout, extracts og:title/<title>,
// meta description, page icon and og:image via linkedom, and resolves
// relative URLs against the final (post-redirect) page URL. Any failure —
// network, timeout, non-HTML, parse error — degrades to empty strings and
// never throws, so bookmark creates are never blocked by scraping.
// Favicon resolution: page icon, else cached value, else Google s2.
// When CACHE_KV is present the resolved favicon is cached 30d under
// `favicon:<host>`; without KV the s2 URL is used directly.

import { parseHTML } from "linkedom";

export interface ScrapedMetadata {
  title: string;
  description: string;
  favicon_url: string;
  preview_image_url: string;
}

// 30 days in seconds (KV expirationTtl unit).
export const FAVICON_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

const FETCH_TIMEOUT_MS = 8000;

export function googleFaviconUrl(host: string): string {
  return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
}

export function faviconCacheKey(host: string): string {
  return `links:favicon:${host.toLowerCase()}`;
}

function emptyMetadata(faviconUrl: string): ScrapedMetadata {
  return { title: "", description: "", favicon_url: faviconUrl, preview_image_url: "" };
}

async function cacheFavicon(
  kv: KVNamespace | null | undefined,
  host: string,
  value: string,
): Promise<void> {
  if (!kv || !value) return;
  try {
    await kv.put(faviconCacheKey(host), value, {
      expirationTtl: FAVICON_CACHE_TTL_SECONDS,
    });
  } catch {
    // Cache is best-effort; scraping must stay fail-soft.
  }
}

export async function scrapeMetadata(
  url: string,
  kv?: KVNamespace | null,
): Promise<ScrapedMetadata> {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return emptyMetadata("");
  }
  const fallback = googleFaviconUrl(host);
  let cached: string | null = null;
  try {
    cached = (await kv?.get(faviconCacheKey(host))) ?? null;
  } catch {
    cached = null;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: { "user-agent": "nodewarden-links" },
    });
  } catch {
    if (cached) return emptyMetadata(cached);
    await cacheFavicon(kv, host, fallback);
    return emptyMetadata(fallback);
  }

  const pageUrl = res.url || url;
  let html = "";
  try {
    html = await res.text();
  } catch {
    html = "";
  }

  let title = "";
  let description = "";
  let pageIcon = "";
  let preview = "";
  if (html) {
    try {
      const { document } = parseHTML(html);
      const ogTitle = document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.trim();
      title = ogTitle || document.title?.trim() || "";
      description =
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content")
          ?.trim() ||
        document
          .querySelector('meta[property="og:description"]')
          ?.getAttribute("content")
          ?.trim() ||
        "";
      const iconHref = document
        .querySelector(
          'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
        )
        ?.getAttribute("href")
        ?.trim();
      if (iconHref) {
        try {
          pageIcon = new URL(iconHref, pageUrl).toString();
        } catch {
          pageIcon = "";
        }
      }
      const ogImage = document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute("content")
        ?.trim();
      if (ogImage) {
        try {
          preview = new URL(ogImage, pageUrl).toString();
        } catch {
          preview = "";
        }
      }
    } catch {
      // Fail-soft: keep whatever was extracted so far (usually nothing).
    }
  }

  const favicon = pageIcon || cached || fallback;
  await cacheFavicon(kv, host, favicon);
  return {
    title,
    description,
    favicon_url: favicon,
    preview_image_url: preview,
  };
}
