// OIDC admin endpoints (configure SSO) and the start/callback flow.
// SSO is OFF by default — only responds when an admin enables it via /admin/sso.

import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { audit, auditFromReq } from '../audit.js';
import { DEMO, redactForDemo } from '../demo-guard.js';
import {
  getConfig,
  isConfigured,
  testDiscovery,
  buildAuthRequest,
  handleCallback,
  pickClaims,
  mapRole,
  invalidateClientCache,
} from '../auth-providers/oidc.js';

const FLOW_COOKIE = 'bagre_sso_flow';

function maskSecret(cfg) {
  if (!cfg) return cfg;
  const view = {
    ...cfg,
    // Placeholder fixo — NUNCA revelar parte do segredo (nem o sufixo).
    clientSecret: cfg.clientSecret ? '••••••••' : null,
    hasClientSecret: !!cfg.clientSecret,
  };
  // Na demo, o "admin" é anônimo: não vazar issuer/clientId do IdP.
  return redactForDemo(view, ['issuer', 'clientId']);
}

export async function registerOidcRoutes(app) {
  // Public config used by the login screen to decide whether to show the SSO button
  app.get('/api/config', async () => {
    const cfg = await getConfig();
    const allowedDomains = (process.env.SIGNUP_ALLOWED_DOMAINS || 'bagre.com.br')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      auth: {
        local: true,
        oidc: {
          enabled: cfg.enabled && isConfigured(cfg),
          buttonLabel: cfg.buttonLabel,
        },
        signup: {
          enabled: process.env.SIGNUP_ENABLED !== 'false',
          allowedDomains,
        },
      },
      demo: DEMO
        ? {
            enabled: true,
            banner:
              'Ambiente de demonstração — somente leitura. Explore à vontade.',
            // Credenciais propositalmente públicas para login em 1 clique.
            accounts: [
              {
                label: 'Entrar como Admin (demo)',
                role: 'ADMIN',
                email: process.env.DEMO_ADMIN_EMAIL || 'demo-admin@bagre.dev',
                password: process.env.DEMO_ADMIN_PASSWORD || 'demo-admin',
              },
              {
                label: 'Entrar como Leitor (demo)',
                role: 'READER',
                email: process.env.DEMO_READER_EMAIL || 'demo-reader@bagre.dev',
                password: process.env.DEMO_READER_PASSWORD || 'demo-reader',
              },
            ],
          }
        : { enabled: false },
    };
  });

  // Admin: read current config (secret masked)
  app.get('/api/admin/oidc-config', { preHandler: requireAdmin }, async () => {
    const cfg = await getConfig();
    return maskSecret(cfg);
  });

  // Admin: update config (partial). If clientSecret is omitted, we keep the existing one.
  app.patch('/api/admin/oidc-config', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    const data = {};
    const fields = [
      'enabled',
      'buttonLabel',
      'issuerUrl',
      'clientId',
      'redirectUri',
      'scopes',
      'adminGroups',
      'groupsClaim',
      'emailClaim',
      'nameClaim',
      'autoProvision',
      'defaultRole',
    ];
    for (const f of fields) {
      if (f in body) data[f] = body[f];
    }
    // clientSecret: only update if non-empty value is provided (allows masked field to be left alone)
    if (body.clientSecret && !String(body.clientSecret).startsWith('••••')) {
      data.clientSecret = body.clientSecret;
    }
    const before = await getConfig();
    const after = await prisma.oidcConfig.update({ where: { id: 1 }, data });
    invalidateClientCache();
    await auditFromReq(req, {
      entity: 'oidc_config',
      entityId: 1,
      action: 'update',
      before: maskSecret(before),
      after: maskSecret(after),
    });
    // Refuse to keep enabled=true when essentials missing
    if (after.enabled && !isConfigured(after)) {
      reply.code(400);
      return {
        error:
          'SSO está habilitado mas faltam campos obrigatórios (issuer, client id/secret, redirect uri).',
        config: maskSecret(after),
      };
    }
    return maskSecret(after);
  });

  // Admin: test issuer discovery
  app.post('/api/admin/oidc-config/test', { preHandler: requireAdmin }, async (req) => {
    const cfg = await getConfig();
    const result = await testDiscovery(cfg);
    await prisma.oidcConfig.update({
      where: { id: 1 },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : 'error',
        lastTestMessage: result.message,
      },
    });
    return result;
  });

  // ---- SSO authentication flow (public) ----

  // Step 1: redirect the user to the IdP
  app.get('/api/auth/sso/start', async (req, reply) => {
    const cfg = await getConfig();
    if (!cfg.enabled || !isConfigured(cfg)) {
      reply.code(503);
      return { error: 'SSO não habilitado' };
    }
    const next = typeof req.query?.next === 'string' ? req.query.next : '/';
    const { url, flow } = await buildAuthRequest(next);
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth/sso',
      maxAge: 600,
    });
    reply.redirect(url);
  });

  // Step 2: callback from IdP -> issue local JWT and redirect to SPA
  app.get('/api/auth/sso/callback', async (req, reply) => {
    const cfg = await getConfig();
    if (!cfg.enabled || !isConfigured(cfg)) {
      reply.code(503);
      return { error: 'SSO não habilitado' };
    }
    const flowRaw = req.cookies?.[FLOW_COOKIE];
    if (!flowRaw) {
      reply.code(400);
      return { error: 'Sessão SSO ausente — refaça o login' };
    }
    const flow = JSON.parse(flowRaw);
    let claims, userinfo;
    try {
      const r = await handleCallback(req.raw, flow);
      claims = r.claims;
      userinfo = r.userinfo;
    } catch (err) {
      reply.code(400);
      return { error: 'Falha no SSO: ' + err.message };
    }
    const picked = pickClaims(cfg, claims, userinfo);
    if (!picked.email || !picked.sub) {
      reply.code(400);
      return { error: 'IdP não retornou email/sub — verifique escopos e claims' };
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { externalId: picked.sub } });
    if (!user) user = await prisma.user.findUnique({ where: { email: picked.email.toLowerCase() } });

    const role = mapRole(cfg, picked.groups || []);

    if (!user) {
      if (!cfg.autoProvision) {
        reply.code(403);
        return { error: 'Usuário não cadastrado e provisionamento automático desligado' };
      }
      user = await prisma.user.create({
        data: {
          email: picked.email.toLowerCase(),
          name: picked.name,
          authProvider: 'oidc',
          externalId: picked.sub,
          externalGroups: picked.groups,
          role,
          active: true,
        },
      });
      await audit({
        entity: 'user',
        entityId: user.id,
        action: 'create',
        actor: 'oidc',
        after: { email: user.email, role: user.role, authProvider: 'oidc' },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          authProvider: 'oidc',
          externalId: picked.sub,
          externalGroups: picked.groups,
          name: user.name || picked.name,
          // role updates only if adminGroups are configured (otherwise let admin manage manually)
          role: cfg.adminGroups?.length ? role : user.role,
          lastLoginAt: new Date(),
        },
      });
    }

    if (!user.active) {
      reply.code(403);
      return { error: 'Conta inativa' };
    }

    await audit({
      entity: 'user',
      entityId: user.id,
      action: 'login',
      actor: user.email,
      ip: req.ip,
    });

    const token = await reply.jwtSign(
      { sub: String(user.id), role: user.role, email: user.email },
      { expiresIn: 60 * 60 * 8 },
    );

    reply.clearCookie(FLOW_COOKIE, { path: '/api/auth/sso' });

    // Redirect back to the SPA com o token. A origem do redirect vem SEMPRE de
    // fonte server-side confiável (env APP_BASE_URL ou a origem do redirectUri
    // configurado) — NUNCA dos headers Origin/Host do request, senão um atacante
    // entregaria o token recém-emitido numa origem arbitrária (open-redirect +
    // vazamento de token). O `next` é sanitizado pra caminho local (anti
    // open-redirect via //evil.com ou URL absoluta).
    const origin = ssoFrontendOrigin(cfg, req);
    const next = encodeURIComponent(safeNextPath(flow.next));
    reply.redirect(`${origin}/sso-callback?token=${token}&next=${next}`);
  });
}

// Origem do SPA pra onde devolver o token: só fontes confiáveis do servidor.
function ssoFrontendOrigin(cfg, req) {
  const fromEnv = process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL;
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* ignore */
    }
  }
  if (cfg?.redirectUri) {
    try {
      return new URL(cfg.redirectUri).origin;
    } catch {
      /* ignore */
    }
  }
  // Fallback (dev): mesma origem do request. Em produção o redirectUri sempre
  // existe (isConfigured exige), então este caminho não roda em deploy real.
  return `${req.protocol}://${req.headers.host}`.replace(/:3001$/, ':3000');
}

// Só permite caminho local: começa com '/' e não com '//' (protocol-relative),
// sem esquema. Qualquer outra coisa vira '/'.
function safeNextPath(next) {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.includes('\\') || /^\/+\w+:/.test(next)) return '/';
  return next;
}
