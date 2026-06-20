import { prisma } from '../db.js';
import { hashPassword, newToken, requireAdmin, requireAuth } from '../auth.js';
import { auditFromReq } from '../audit.js';
import { DEMO, demoBlock } from '../demo-guard.js';

// No DEMO_MODE as contas são públicas e compartilhadas — qualquer gestão de
// usuários (criar/editar/role/remover/reset de senha) é desabilitada pra impedir
// que um visitante troque a senha ou escale o papel das contas demo (lockout).
const DEMO_USERS_MSG = 'Gestão de usuários desabilitada no ambiente de demonstração.';

function projectUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
    mustChangePwd: u.mustChangePwd,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    // Origem da autenticação (local / ldap / oidc) — evidência de que o login
    // veio do diretório. externalId = DN no AD; externalGroups = grupos do AD.
    // Não são segredos (é a procedência do usuário); senha/hash nunca saem daqui.
    authProvider: u.authProvider || 'local',
    externalId: u.externalId || null,
    externalGroups: u.externalGroups || [],
  };
}

export async function registerUsers(app) {
  // List users — admin only
  app.get('/api/users', { preHandler: requireAdmin }, async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(projectUser);
  });

  // Create user — admin only. If `password` omitted, a reset token is returned
  // so the admin can hand a one-time link to the user.
  app.post('/api/users', { preHandler: requireAdmin }, async (req, reply) => {
    if (DEMO) return demoBlock(reply, DEMO_USERS_MSG);
    const { email, name, role = 'READER', password } = req.body || {};
    if (!email) {
      reply.code(400);
      return { error: 'email obrigatório' };
    }
    if (!['ADMIN', 'READER'].includes(role)) {
      reply.code(400);
      return { error: 'role inválida' };
    }
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) {
      reply.code(409);
      return { error: 'email já cadastrado' };
    }
    let resetToken = null;
    let passwordHash;
    if (password && password.length >= 8) {
      passwordHash = await hashPassword(password);
    } else {
      // Generate a placeholder hash; user must reset before logging in.
      passwordHash = await hashPassword(newToken());
    }
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name: name || null,
        role,
        passwordHash,
        mustChangePwd: true,
      },
    });
    if (!password) {
      resetToken = newToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: resetToken,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
        },
      });
    }
    await auditFromReq(req, {
      entity: 'user',
      entityId: user.id,
      action: 'create',
      after: projectUser(user),
    });
    return { user: projectUser(user), resetToken };
  });

  // Patch user — admin only
  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (DEMO) return demoBlock(reply, DEMO_USERS_MSG);
    const id = Number(req.params.id);
    const { name, role, active } = req.body || {};
    const data = {};
    if (typeof name !== 'undefined') data.name = name;
    if (typeof role !== 'undefined') {
      if (!['ADMIN', 'READER'].includes(role)) {
        reply.code(400);
        return { error: 'role inválida' };
      }
      data.role = role;
    }
    if (typeof active === 'boolean') data.active = active;
    const before = await prisma.user.findUnique({ where: { id } });
    const updated = await prisma.user.update({ where: { id }, data });
    await auditFromReq(req, {
      entity: 'user',
      entityId: id,
      action: 'update',
      before: before && projectUser(before),
      after: projectUser(updated),
    });
    return projectUser(updated);
  });

  // Delete user — admin only. Refuse to delete self or last admin.
  app.delete('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    if (DEMO) return demoBlock(reply, DEMO_USERS_MSG);
    const id = Number(req.params.id);
    if (id === req.user.id) {
      reply.code(400);
      return { error: 'não é possível remover o próprio usuário' };
    }
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      reply.code(404);
      return { error: 'usuário não encontrado' };
    }
    if (target.role === 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (adminCount <= 1) {
        reply.code(400);
        return { error: 'não é possível remover o último admin ativo' };
      }
    }
    await prisma.user.delete({ where: { id } });
    await auditFromReq(req, {
      entity: 'user',
      entityId: id,
      action: 'delete',
      before: projectUser(target),
    });
    return { ok: true };
  });

  // Force a password reset token for a user — admin only. Returns the token
  // so the admin can hand the link to the user.
  app.post('/api/users/:id/reset', { preHandler: requireAdmin }, async (req, reply) => {
    if (DEMO) return demoBlock(reply, DEMO_USERS_MSG);
    const id = Number(req.params.id);
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      reply.code(404);
      return { error: 'usuário não encontrado' };
    }
    const token = newToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: id,
        token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });
    await prisma.user.update({
      where: { id },
      data: { mustChangePwd: true },
    });
    await auditFromReq(req, {
      entity: 'user',
      entityId: id,
      action: 'reset_password',
      after: { email: target.email },
    });
    return { token, expiresInDays: 7 };
  });
}
