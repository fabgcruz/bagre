import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { auditFromReq } from '../audit.js';
import { DEMO, demoBlock } from '../demo-guard.js';
import { generateApiToken } from '../api-token.js';

// API tokens authorize automation (Terraform provider, K8s operator, CI) without
// a user login. Management is ADMIN-only and disabled in the public demo. The
// plaintext token is returned exactly once, at creation — never stored or shown
// again. See src/api-token.js for the security model.

const DEMO_MSG = 'Gestão de tokens de API desabilitada no ambiente de demonstração.';

// Never leak the hash. `prefix` is a safe identifier (not enough to authenticate).
function projectToken(t) {
  return {
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scope: t.scope,
    lastUsedAt: t.lastUsedAt,
    expiresAt: t.expiresAt,
    revokedAt: t.revokedAt,
    createdAt: t.createdAt,
  };
}

export async function registerApiTokens(app) {
  // List tokens — admin only. Hash is never returned.
  app.get('/api/api-tokens', { preHandler: requireAdmin }, async () => {
    const tokens = await prisma.apiToken.findMany({ orderBy: { createdAt: 'desc' } });
    return tokens.map(projectToken);
  });

  // Create a token — admin only. Returns the plaintext token ONCE.
  app.post('/api/api-tokens', { preHandler: requireAdmin }, async (req, reply) => {
    if (DEMO) return demoBlock(reply, DEMO_MSG);
    const { name, scope = 'READ_WRITE', expiresInDays } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      reply.code(400);
      return { error: 'name obrigatório' };
    }
    if (!['READ_ONLY', 'READ_WRITE'].includes(scope)) {
      reply.code(400);
      return { error: 'scope inválido (READ_ONLY | READ_WRITE)' };
    }
    let expiresAt = null;
    if (typeof expiresInDays !== 'undefined' && expiresInDays !== null) {
      const days = Number(expiresInDays);
      if (!Number.isFinite(days) || days <= 0) {
        reply.code(400);
        return { error: 'expiresInDays deve ser um número positivo' };
      }
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const { token, tokenHash, prefix } = generateApiToken();
    const created = await prisma.apiToken.create({
      data: {
        name: name.trim(),
        tokenHash,
        prefix,
        scope,
        expiresAt,
        createdById: req.user?.id ?? null,
      },
    });
    await auditFromReq(req, {
      entity: 'api_token',
      entityId: created.id,
      action: 'create',
      after: projectToken(created),
    });
    // `token` is included ONLY in this response and never again.
    return reply.code(201).send({ ...projectToken(created), token });
  });

  // Revoke a token — admin only. Soft-revoke keeps the audit trail; the auth
  // lookup ignores revoked tokens immediately.
  app.delete('/api/api-tokens/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (DEMO) return demoBlock(reply, DEMO_MSG);
    const id = Number(req.params.id);
    const target = await prisma.apiToken.findUnique({ where: { id } });
    if (!target) {
      reply.code(404);
      return { error: 'token não encontrado' };
    }
    if (target.revokedAt) {
      return projectToken(target); // already revoked — idempotent
    }
    const updated = await prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await auditFromReq(req, {
      entity: 'api_token',
      entityId: id,
      action: 'revoke',
      before: projectToken(target),
      after: projectToken(updated),
    });
    return projectToken(updated);
  });
}
