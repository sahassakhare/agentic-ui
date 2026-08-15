import { createHash, randomBytes } from 'node:crypto';

/**
 * Embed keys authenticate anonymous, read-only, origin-pinned access to a
 * published experience manifest. The RAW key is shown to the publisher exactly
 * once (at publish / rotate time); the catalog stores only its SHA-256 hash, so
 * a database compromise never yields usable keys.
 */

const KEY_PREFIX = 'emb_';

/** Mint a fresh embed key. Returns the raw key and a non-secret display prefix. */
export function mintEmbedKey(): { raw: string; prefix: string } {
  // 32 bytes → 43-char base64url secret; ample entropy, URL-safe for headers.
  const secret = randomBytes(32).toString('base64url');
  const raw = `${KEY_PREFIX}${secret}`;
  return { raw, prefix: keyPrefixOf(raw) };
}

/** SHA-256 hex of a raw key — the only form persisted / compared. */
export function hashEmbedKey(raw: string): string {
  return createHash('sha256').update(raw.trim()).digest('hex');
}

/** Short, non-secret label for the UI (e.g. `emb_ab12…`). */
export function keyPrefixOf(raw: string): string {
  const body = raw.startsWith(KEY_PREFIX) ? raw.slice(KEY_PREFIX.length) : raw;
  return `${KEY_PREFIX}${body.slice(0, 4)}…`;
}
