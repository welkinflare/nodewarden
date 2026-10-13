// Profile / settings / tokens (linkding parity).
// profile and settings are two views over the same link_profile row
// (seeded with defaults on first read). Tokens: link_api_tokens keyed by a
// 48-char random hex (24 WebCrypto bytes); link_feed_tokens holds a single
// create-or-get key per user for /api/links/feeds/*.atom.
// Errors are {detail}; no vault-sync side effects.

import type { Env } from '../../types';
import { jsonResponse } from '../../utils/response';
import { LinksStorage, type LinkProfileRow } from '../../services/links-storage';

function serializeProfile(row: LinkProfileRow): Record<string, unknown> {
  return {
    theme: row.theme,
    bookmark_date_display: row.bookmark_date_display,
    bookmark_link_target: row.bookmark_link_target,
    web_archive_integration: row.web_archive_integration,
    tag_search: row.tag_search,
    enable_sharing: row.enable_sharing,
    enable_public_sharing: row.enable_public_sharing,
    enable_favicons: row.enable_favicons,
    display_url: row.display_url,
    permanent_notes: row.permanent_notes,
    search_preferences: row.search_preferences,
    auto_tagging_rules: row.auto_tagging_rules,
    items_per_page: row.items_per_page,
    legacy_search: row.legacy_search,
    custom_css: row.custom_css,
  };
}

function parseFlag(value: unknown): number {
  return value === 1 || value === true || value === '1' || value === 'true' ? 1 : 0;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Builds a validated link_profile patch from an arbitrary JSON body.
// Returns the patch, or a 400 Response when a value is invalid.
function buildProfilePatch(body: Record<string, unknown>): Record<string, unknown> | Response {
  const patch: Record<string, unknown> = {};
  for (const field of [
    'theme',
    'bookmark_date_display',
    'bookmark_link_target',
    'web_archive_integration',
    'search_preferences',
    'auto_tagging_rules',
    'custom_css',
  ] as const) {
    if (body[field] !== undefined) patch[field] = String(body[field]);
  }
  if (body['tag_search'] !== undefined) {
    const mode = String(body['tag_search']).toLowerCase();
    if (mode !== 'strict' && mode !== 'loose') {
      return jsonResponse({ detail: 'tag_search must be strict or loose.' }, 400);
    }
    patch['tag_search'] = mode;
  }
  for (const field of [
    'enable_sharing',
    'enable_public_sharing',
    'enable_favicons',
    'display_url',
    'permanent_notes',
    'legacy_search',
  ] as const) {
    if (body[field] !== undefined) patch[field] = parseFlag(body[field]);
  }
  if (body['items_per_page'] !== undefined) {
    const n = Number(body['items_per_page']);
    if (!Number.isInteger(n) || n < 1) {
      return jsonResponse({ detail: 'items_per_page must be a positive integer.' }, 400);
    }
    patch['items_per_page'] = Math.min(n, 100);
  }
  return patch;
}

export async function handleGetLinksProfile(request: Request, env: Env, userId: string): Promise<Response> {
  void request;
  const store = new LinksStorage(env.DB);
  await store.ensureLinksProfile(userId);
  const profile = await store.getLinksProfile(userId);
  if (!profile) return jsonResponse({ detail: 'Not found.' }, 404);
  return jsonResponse(serializeProfile(profile));
}

export async function handleUpdateLinksProfile(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const patch = buildProfilePatch(await readJsonBody(request));
  if (patch instanceof Response) return patch;
  const updated = await new LinksStorage(env.DB).updateLinksProfile(userId, patch);
  if (!updated) return jsonResponse({ detail: 'Not found.' }, 404);
  return jsonResponse(serializeProfile(updated));
}

export async function handleGetLinksSettings(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  return handleGetLinksProfile(request, env, userId);
}

export async function handleUpdateLinksSettings(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  return handleUpdateLinksProfile(request, env, userId);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// 24 random bytes as 48 lowercase hex chars (api/feed token keys).
function newTokenKey(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
}

export async function handleListLinksTokens(request: Request, env: Env, userId: string): Promise<Response> {
  void request;
  const store = new LinksStorage(env.DB);
  const [apiTokens, feedToken] = await Promise.all([
    store.listApiTokens(userId),
    store.getFeedToken(userId),
  ]);
  return jsonResponse({
    api_tokens: apiTokens.map((t) => ({
      id: t.id,
      name: t.name,
      key: t.key,
      created: t.created,
    })),
    feed_token: feedToken ? { key: feedToken.key, created: feedToken.created } : null,
  });
}

export async function handleCreateLinksToken(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const body = await readJsonBody(request);
  const store = new LinksStorage(env.DB);
  const now = new Date().toISOString();
  if (body['feed'] === true || String(body['type'] ?? '') === 'feed') {
    const row = await store.createOrGetFeedToken(userId, newTokenKey(), now);
    return jsonResponse({ key: row.key, created: row.created });
  }
  const name = String(body['name'] ?? '');
  const row = await store.createApiToken({ userId, key: newTokenKey(), name, created: now });
  return jsonResponse({ id: row.id, name: row.name, key: row.key, created: row.created }, 201);
}

export async function handleDeleteLinksToken(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  void request;
  const deleted = await new LinksStorage(env.DB).deleteApiToken(userId, id);
  if (!deleted) return jsonResponse({ detail: 'Not found.' }, 404);
  return new Response(null, { status: 204 });
}
