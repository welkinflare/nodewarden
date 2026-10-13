// Links token auth (linkding API-token parity).
// Verifies `Authorization: Token <key>` against link_api_tokens and checks
// the owning nodewarden user is still active. Used ONLY by the public
// /api/bookmarks/* routes; the session /api/links/* routes authenticate via
// the Bitwarden JWT (userId param) and never consult this helper.

import type { Env } from '../../types';
import { LinksStorage } from '../../services/links-storage';

export async function verifyLinksToken(
  request: Request,
  env: Env
): Promise<{ userId: string } | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return null;
  const match = /^Token (\S+)$/.exec(authHeader.trim());
  if (!match) return null;
  const store = new LinksStorage(env.DB);
  const userId = await store.findUserIdByTokenKey(match[1]);
  if (!userId) return null;
  const access = await store.getUserAccess(userId);
  if (!access || !access.active) return null;
  return { userId: access.id };
}
