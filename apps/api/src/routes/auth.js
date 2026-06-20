import { prisma } from '../db.js';
import { hashPassword, verifyPassword, newToken, requireAuth } from '../auth.js';
import { audit } from '../audit.js';
import { rateLimit } from '../rate-limit.js';
import { DEMO, demoBlock } from '../demo-guard.js';
import * as ldapProvider from '../auth-providers/ldap.js';

const TOKEN_TTL_MIN = 60 * 60 * 8; // 8h

// Proteção contra brute force nos endpoints de auth (por IP, janela de 5min).
// O teto do login é configurável via LOGIN_RATE_MAX: mantemos um default
// folgado o bastante pra um escritório atrás de NAT (vários usuários, mesmo IP),
// mas o ambiente de demonstração público fixa um valor BEM mais apertado
// (LOGIN_RATE_MAX=12 no docker-compose.demo.yml) — lá o login é o único write
// exposto, então é a superfície que mais precisa ser blindada.
const LOGIN_MAX = Math.max(3, Number(process.env.LOGIN_RATE_MAX) || 30);
const loginLimit = rateLimit({ name: 'login', windowMs: 5 * 60_000, max: LOGIN_MAX });
const signupLimit = rateLimit({ name: 'signup', windowMs: 5 * 60_000, max: 20 });
const resetLimit = rateLimit({ name: 'reset', windowMs: 5 * 60_000, max: 20 });

export async function registerAuth(app) {
  // Emite o token + audita + atualiza lastLoginAt. Reusado por login local e LDAP.
  async function issueLogin(reply, user, ip, via = 'local') {
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await audit({ entity: 'user', entityId: user.id, action: 'login', actor: `${user.email} (${via})`, ip });
    const token = await reply.jwtSign(
      { sub: String(user.id), role: user.role, email: user.email },
      { expiresIn: TOKEN_TTL_MIN },
    );
    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePwd: user.mustChangePwd },
    };
  }

  // Provisiona/atualiza o usuário local a partir de um login LDAP bem-sucedido.
  async function provisionLdapUser(cfg, result) {
    let user =
      (await prisma.user.findUnique({ where: { externalId: result.dn } })) ||
      (await prisma.user.findUnique({ where: { email: result.email } }));
    if (!user) {
      if (!cfg.autoProvision) return null;
      user = await prisma.user.create({
        data: {
          email: result.email,
          name: result.name,
          authProvider: 'ldap',
          externalId: result.dn,
          externalGroups: result.groups,
          role: result.role,
          active: true,
        },
      });
      await audit({ entity: 'user', entityId: user.id, action: 'create', actor: 'ldap', after: { email: user.email, role: user.role, authProvider: 'ldap' } });
      return user;
    }
    return prisma.user.update({
      where: { id: user.id },
      data: {
        authProvider: 'ldap',
        externalId: result.dn,
        externalGroups: result.groups,
        name: user.name || result.name,
        // só sobrescreve o papel se há adminGroups configurados; senão o admin gerencia manual.
        role: cfg.adminGroups?.length ? result.role : user.role,
      },
    });
  }

  app.post('/api/auth/login', { preHandler: loginLimit }, async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      reply.code(400);
      return { error: 'email e password obrigatórios' };
    }

    // 1) Autenticação LOCAL — só se o usuário tem senha local.
    const localUser = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (localUser && localUser.active && localUser.passwordHash) {
      const ok = await verifyPassword(password, localUser.passwordHash);
      if (ok) return issueLogin(reply, localUser, req.ip, 'local');
    }

    // 2) Autenticação LDAP/AD — se habilitada. O campo "email" é tratado como
    //    username (ex.: sAMAccountName) e passado ao filtro do AD.
    try {
      const ldapCfg = await ldapProvider.getConfig();
      if (ldapCfg.enabled && ldapProvider.isConfigured(ldapCfg)) {
        const result = await ldapProvider.authenticate(ldapCfg, email, password);
        if (result) {
          const user = await provisionLdapUser(ldapCfg, result);
          if (!user) {
            reply.code(403);
            return { error: 'Usuário válido no AD, mas provisionamento automático está desligado.' };
          }
          if (!user.active) {
            reply.code(403);
            return { error: 'Conta inativa' };
          }
          return issueLogin(reply, user, req.ip, 'ldap');
        }
      }
    } catch (err) {
      req.log.warn({ err: err.message }, 'erro na autenticação LDAP');
      // cai pro 401 abaixo — não vaza detalhe do erro pro cliente.
    }

    reply.code(401);
    return { error: 'credenciais inválidas' };
  });

  app.post('/api/auth/signup', { preHandler: signupLimit }, async (req, reply) => {
    if (process.env.SIGNUP_ENABLED === 'false') {
      reply.code(403);
      return { error: 'cadastro de novas contas está desativado' };
    }
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      reply.code(400);
      return { error: 'email e password obrigatórios' };
    }
    if (String(password).length < 8) {
      reply.code(400);
      return { error: 'senha precisa ter pelo menos 8 caracteres' };
    }
    const normalized = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      reply.code(400);
      return { error: 'email inválido' };
    }
    const allowed = (process.env.SIGNUP_ALLOWED_DOMAINS || 'bagre.com.br')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const domain = normalized.split('@')[1];
    if (allowed.length && !allowed.includes(domain)) {
      reply.code(400);
      return { error: `email precisa ser de um dos domínios: ${allowed.join(', ')}` };
    }
    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      reply.code(409);
      return { error: 'email já cadastrado' };
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email: normalized,
        name: name ? String(name).trim() || null : null,
        passwordHash,
        role: 'READER',
        active: true,
        mustChangePwd: false,
        authProvider: 'local',
      },
    });
    await audit({
      entity: 'user',
      entityId: user.id,
      action: 'signup',
      actor: user.email,
      ip: req.ip,
    });
    const token = await reply.jwtSign(
      { sub: String(user.id), role: user.role, email: user.email },
      { expiresIn: TOKEN_TTL_MIN },
    );
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePwd: user.mustChangePwd,
      },
    };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    return req.user;
  });

  app.post('/api/auth/change-password', { preHandler: [resetLimit, requireAuth] }, async (req, reply) => {
    // No DEMO as contas são fixas e compartilhadas — trocar a senha travaria o
    // login 1-clique pra todos os próximos visitantes.
    if (DEMO) return demoBlock(reply, 'Troca de senha desabilitada no ambiente de demonstração.');
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) {
      reply.code(400);
      return { error: 'nova senha precisa ter pelo menos 8 caracteres' };
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const ok = await verifyPassword(currentPassword || '', user.passwordHash);
    if (!ok) {
      reply.code(401);
      return { error: 'senha atual incorreta' };
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword), mustChangePwd: false },
    });
    await audit({
      entity: 'user',
      entityId: user.id,
      action: 'change_password',
      actor: user.email,
      ip: req.ip,
    });
    return { ok: true };
  });

  // Self-service reset request: generates a token if user exists. Always
  // returns 200 to avoid user enumeration. The token is logged on the server
  // so the admin can hand it out (no email integration in this MVP).
  app.post('/api/auth/reset-request', { preHandler: resetLimit }, async (req, reply) => {
    const { email } = req.body || {};
    if (!email) {
      reply.code(400);
      return { error: 'email obrigatório' };
    }
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && user.active) {
      const token = newToken();
      const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1h
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });
      app.log.warn(
        `password-reset issued for ${user.email} → token=${token} (expires ${expiresAt.toISOString()})`,
      );
    }
    return { ok: true };
  });

  // Apply a reset token to set a new password.
  app.post('/api/auth/reset', { preHandler: resetLimit }, async (req, reply) => {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || newPassword.length < 8) {
      reply.code(400);
      return { error: 'token e nova senha (min 8 chars) obrigatórios' };
    }
    const rec = await prisma.passwordResetToken.findUnique({ where: { token } });
    if (!rec || rec.consumedAt || rec.expiresAt < new Date()) {
      reply.code(400);
      return { error: 'token inválido ou expirado' };
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: rec.userId },
        data: { passwordHash: await hashPassword(newPassword), mustChangePwd: false },
      }),
      prisma.passwordResetToken.update({
        where: { id: rec.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    await audit({
      entity: 'user',
      entityId: rec.userId,
      action: 'reset_password_apply',
      actor: 'self-service',
      ip: req.ip,
    });
    return { ok: true };
  });
}
