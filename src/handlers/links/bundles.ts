// Bundle CRUD (linkding parity): saved searches scoped per user.
// any/all/excluded_tags accept a comma-separated string or a string array
// and are stored as normalized comma-separated text; filter_unread and
// filter_shared are 0/1 flags. Foreign or missing ids are a generic 404.
// Errors are {detail}; no vault-sync side effects.

import type { Env } from '../../types';
import { jsonResponse } from '../../utils/response';
import { LinksStorage, type LinkBundleRow } from '../../services/links-storage';

const NOT_FOUND = 'Not found.';

function serializeBundle(row: LinkBundleRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    search: row.search,
    any_tags: row.any_tags,
    all_tags: row.all_tags,
    excluded_tags: row.excluded_tags,
    filter_unread: row.filter_unread,
    filter_shared: row.filter_shared,
    order: row.order,
    date_created: row.date_created,
    date_modified: row.date_modified,
  };
}

function normalizeTagsField(value: unknown): string {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return list
    .map((v) => String(v ?? '').trim())
    .filter((v) => v.length > 0)
    .join(',');
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

export async function handleListBundles(request: Request, env: Env, userId: string): Promise<Response> {
  void request;
  const rows = await new LinksStorage(env.DB).listBundles(userId);
  return jsonResponse(rows.map(serializeBundle));
}

export async function handleCreateBundle(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body['name'] ?? '').trim();
  if (!name) return jsonResponse({ detail: 'Name is required.' }, 400);
  const row = await new LinksStorage(env.DB).createBundle({
    userId,
    name,
    search: String(body['search'] ?? ''),
    anyTags: normalizeTagsField(body['any_tags']),
    allTags: normalizeTagsField(body['all_tags']),
    excludedTags: normalizeTagsField(body['excluded_tags']),
    filterUnread: parseFlag(body['filter_unread'] ?? 0),
    filterShared: parseFlag(body['filter_shared'] ?? 0),
    order: String(body['order'] ?? ''),
    now: new Date().toISOString(),
  });
  return jsonResponse(serializeBundle(row), 201);
}

export async function handleGetBundle(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  void request;
  const row = await new LinksStorage(env.DB).getBundleById(userId, id);
  if (!row) return jsonResponse({ detail: NOT_FOUND }, 404);
  return jsonResponse(serializeBundle(row));
}

export async function handleUpdateBundle(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const store = new LinksStorage(env.DB);
  const row = await store.getBundleById(userId, id);
  if (!row) return jsonResponse({ detail: NOT_FOUND }, 404);
  const body = await readJsonBody(request);
  const patch: Record<string, unknown> = {
    date_modified: new Date().toISOString(),
  };
  if (body['name'] !== undefined) {
    const name = String(body['name']).trim();
    if (!name) return jsonResponse({ detail: 'Name is required.' }, 400);
    patch['name'] = name;
  }
  if (body['search'] !== undefined) patch['search'] = String(body['search']);
  if (body['any_tags'] !== undefined) patch['any_tags'] = normalizeTagsField(body['any_tags']);
  if (body['all_tags'] !== undefined) patch['all_tags'] = normalizeTagsField(body['all_tags']);
  if (body['excluded_tags'] !== undefined) {
    patch['excluded_tags'] = normalizeTagsField(body['excluded_tags']);
  }
  if (body['filter_unread'] !== undefined) {
    patch['filter_unread'] = parseFlag(body['filter_unread']);
  }
  if (body['filter_shared'] !== undefined) {
    patch['filter_shared'] = parseFlag(body['filter_shared']);
  }
  if (body['order'] !== undefined) patch['order'] = String(body['order']);
  const updated = await store.updateBundle(userId, id, patch);
  if (!updated) return jsonResponse({ detail: NOT_FOUND }, 404);
  return jsonResponse(serializeBundle(updated));
}

export async function handleDeleteBundle(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  void request;
  const deleted = await new LinksStorage(env.DB).deleteBundle(userId, id);
  if (!deleted) return jsonResponse({ detail: NOT_FOUND }, 404);
  return new Response(null, { status: 204 });
}
