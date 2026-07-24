// API tokens for automation (Terraform provider, K8s operator, CI scripts).
//
// Security model:
// - The token is `bagre_<43 random base64url chars>`. Only its SHA-256 hash is
//   persisted; the plaintext is returned exactly once, at creation time.
// - Lookup is by hash (the presented token is hashed and matched), so a DB leak
//   never exposes a usable credential.
// - Tokens carry a scope (READ_ONLY / READ_WRITE) and can be revoked or expire.
// - The global auth hook (index.js) forbids API tokens from touching
//   /api/api-tokens and /api/users — no privilege persistence or escalation.

import crypto from 'node:crypto';
import { prisma } from './db.js';

export const API_TOKEN_PREFIX = 'bagre_';

export function hashApiToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function looksLikeApiToken(str) {
  return typeof str === 'string' && str.startsWith(API_TOKEN_PREFIX);
}

/** Mint a fresh token. Returns the plaintext (show once) + what to persist. */
export function generateApiToken() {
  const secret = crypto.randomBytes(32).toString('base64url');
  const token = API_TOKEN_PREFIX + secret;
  return {
    token, // plaintext — return to caller once, never store
    tokenHash: hashApiToken(token),
    prefix: token.slice(0, 14), // "bagre_" + 8 chars, safe to display
  };
}

/**
 * Resolve a presented token to its DB row, or null if unknown/revoked/expired.
 * Stamps lastUsedAt best-effort (never blocks the request on it).
 */
export async function resolveApiToken(token) {
  const tokenHash = hashApiToken(token);
  const row = await prisma.apiToken.findUnique({ where: { tokenHash } });
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  prisma.apiToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return row;
}
