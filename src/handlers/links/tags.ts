// Tag CRUD + merge (linkding parity).
// All reads and writes are scoped by the userId param; foreign or missing
// ids always answer with a generic 404 that leaks nothing.
// Tag names are UNIQUE(user_id, name) NOCASE: duplicates in any case are a
// 400, and merge re-points bookmark_tags onto the target in one batch.
// Errors are {detail} (never nodewarden ErrorModel); no vault-sync side
// effects.

import type { Env } from '../../types';
import { jsonResponse } from '../../utils/response';
import { LinksStorage, type LinkTagRow } from '../../services/links-storage';

const NOT_FOUND = 'Not found.';

function serializeTag(row: LinkTagRow, bookmarkCount?: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    date_added: row.date_added,
  };
  if (bookmarkCount !== undefined) out['bookmark_count'] = bookmarkCount;
  return out;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function handleListTags(request: Request, env: Env, userId: string): Promise<Response> {
  void request;
  const rows = await new LinksStorage(env.DB).listTags(userId);
  return jsonResponse(rows.map((r) => serializeTag(r, Number(r.bookmark_count ?? 0))));
}

export async function handleCreateTag(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const name = String(body['name'] ?? '').trim();
  if (!name) return jsonResponse({ detail: 'Name is required.' }, 400);
  const store = new LinksStorage(env.DB);
  if (await store.findTagByName(userId, name)) {
    return jsonResponse({ detail: 'A tag with this name already exists.' }, 400);
  }
  const row = await store.createTag(userId, name, new Date().toISOString());
  return jsonResponse(serializeTag(row), 201);
}

export async function handleGetTag(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  void request;
  const row = await new LinksStorage(env.DB).getTagById(userId, id);
  if (!row) return jsonResponse({ detail: NOT_FOUND }, 404);
  return jsonResponse(serializeTag(row));
}

export async function handleUpdateTag(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  const store = new LinksStorage(env.DB);
  const row = await store.getTagById(userId, id);
  if (!row) return jsonResponse({ detail: NOT_FOUND }, 404);
  const body = await readJsonBody(request);
  const name = String(body['name'] ?? '').trim();
  if (!name) return jsonResponse({ detail: 'Name is required.' }, 400);
  const clash = await store.findTagByName(userId, name);
  if (clash && clash.id !== row.id) {
    return jsonResponse({ detail: 'A tag with this name already exists.' }, 400);
  }
  const updated = await store.renameTag(userId, row.id, name);
  if (!updated) return jsonResponse({ detail: NOT_FOUND }, 404);
  return jsonResponse(serializeTag(updated));
}

export async function handleDeleteTag(
  request: Request,
  env: Env,
  userId: string,
  id: string
): Promise<Response> {
  void request;
  const deleted = await new LinksStorage(env.DB).deleteTag(userId, id);
  if (!deleted) return jsonResponse({ detail: NOT_FOUND }, 404);
  return new Response(null, { status: 204 });
}

// POST merge {from, to}: each side accepts a tag id (UUID string) or a tag
// name (string); a missing string target is created. Aliases from_id,
// to_id, from_name, to_name are accepted for client convenience.
// Id-vs-name resolution: a value that matches an owned tag id resolves as
// an id, otherwise it is treated as a name (linkding ids were numeric and
// unambiguous; UUID strings share the string type with names, so lookup
// order is the only disambiguator).
export async function handleMergeTags(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readJsonBody(request);
  const fromRaw = body['from'] ?? body['from_id'] ?? body['from_name'] ?? null;
  const toRaw = body['to'] ?? body['to_id'] ?? body['to_name'] ?? null;
  if (fromRaw === null || fromRaw === undefined || String(fromRaw).trim() === '') {
    return jsonResponse({ detail: 'Source tag (from) is required.' }, 400);
  }
  if (toRaw === null || toRaw === undefined || String(toRaw).trim() === '') {
    return jsonResponse({ detail: 'Target tag (to) is required.' }, 400);
  }

  const store = new LinksStorage(env.DB);
  const fromKey = String(fromRaw).trim();
  const source =
    (await store.getTagById(userId, fromKey)) ?? (await store.findTagByName(userId, fromKey));
  if (!source) return jsonResponse({ detail: NOT_FOUND }, 404);

  const toKey = String(toRaw).trim();
  let target: LinkTagRow | null = await store.getTagById(userId, toKey);
  if (!target) {
    // Explicit *_id aliases that miss are a 404 (id semantics requested);
    // anything else falls back to name semantics (auto-create the target).
    const explicitId = body['to_id'] !== undefined && String(body['to_id']).trim() === toKey;
    if (explicitId) return jsonResponse({ detail: NOT_FOUND }, 404);
    target = await store.findTagByName(userId, toKey);
    if (!target) {
      target = await store.createTag(userId, toKey, new Date().toISOString());
    }
  }
  if (source.id === target.id) {
    return jsonResponse({ detail: 'Source and target tags are the same.' }, 400);
  }
  const merged = await store.mergeTags(userId, source.id, target.id);
  if (!merged) return jsonResponse({ detail: NOT_FOUND }, 404);
  return jsonResponse(serializeTag(merged));
}
