// TopDesk (ITSM) integration routes — admin-gated.
// Push do IPAM pro Asset Management do TopDesk: preview do diff + aplicação
// manual (mesmo fluxo seguro do DNS). Segredos nunca são revelados.

import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { auditFromReq } from '../audit.js';
import * as topdesk from '../integrations/topdesk/topdesk.js';
import { redactForDemo } from '../demo-guard.js';
import { assertSafeIntegrationUrl } from '../lib/ssrf-guard.js';

const SAFE_FIELDS = [
  'enabled',
  'baseUrl',
  'username',
  'password',
  'assetTemplateId',
  'ipFieldId',
  'hostnameFieldId',
  'intervalMinutes',
];

// Placeholder fixo — NUNCA revelar parte do segredo. O front usa hasPassword.
const MASK = '••••••••';

function safeView(cfg) {
  if (!cfg) return cfg;
  const view = {
    ...cfg,
    password: cfg.password ? MASK : null,
    hasPassword: !!cfg.password,
  };
  // Na demo, o "admin" é anônimo: não vazar URL/usuário do TopDesk interno.
  return redactForDemo(view, ['baseUrl', 'username']);
}

async function getCfg() {
  let cfg = await prisma.topDeskConfig.findUnique({ where: { id: 1 } });
  if (!cfg) cfg = await prisma.topDeskConfig.create({ data: { id: 1 } });
  return cfg;
}

export async function registerTopDeskRoutes(app) {
  app.get('/api/admin/topdesk-config', { preHandler: requireAdmin }, async () => {
    const cfg = await getCfg();
    return safeView(cfg);
  });

  app.patch('/api/admin/topdesk-config', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    const data = {};
    for (const f of SAFE_FIELDS) {
      if (f in body) data[f] = body[f];
    }
    // Não sobrescreve a senha quando a UI reenvia o valor mascarado.
    if (data.password && String(data.password).startsWith('••••')) delete data.password;
    if ('password' in data && data.password === '') data.password = null;
    // Anti-SSRF: rejeita URL apontando pra metadata/link-local/loopback.
    if (data.baseUrl) {
      try {
        await assertSafeIntegrationUrl(data.baseUrl);
      } catch (e) {
        reply.code(400);
        return { error: `URL do TopDesk rejeitada: ${e.message}` };
      }
    }
    const before = await getCfg();
    const after = await prisma.topDeskConfig.update({ where: { id: 1 }, data });
    await auditFromReq(req, {
      entity: 'topdesk_config',
      entityId: 1,
      action: 'update',
      before: safeView(before),
      after: safeView(after),
    });
    return safeView(after);
  });

  app.post('/api/admin/topdesk-config/test', { preHandler: requireAdmin }, async () => {
    const cfg = await getCfg();
    const result = await topdesk.testConnection(cfg);
    await prisma.topDeskConfig.update({
      where: { id: 1 },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : 'error',
        lastTestMessage: result.message,
      },
    });
    return result;
  });

  // Lista os templates de ativo pra UI escolher o dedicado ao Bagre.
  app.get('/api/admin/topdesk-config/templates', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = await getCfg();
    if (!cfg.baseUrl || !cfg.username || !cfg.password) {
      reply.code(400);
      return { error: 'configure baseUrl, usuário e senha antes de listar templates' };
    }
    try {
      const templates = await topdesk.listTemplates(cfg);
      return { templates };
    } catch (err) {
      reply.code(502);
      return { error: err.message };
    }
  });

  // Preview do diff (sem aplicar) — "vou criar X ativos, atualizar Y".
  app.get('/api/admin/topdesk-config/preview', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = await getCfg();
    if (!topdesk.isConfigured(cfg)) {
      reply.code(400);
      return { error: 'TopDesk não configurado (baseUrl, credenciais, template e campo de IP obrigatórios)' };
    }
    try {
      const preview = await topdesk.previewSync(prisma, cfg);
      return preview;
    } catch (err) {
      reply.code(502);
      return { error: err.message };
    }
  });

  // Aplica o sync — cria/atualiza ativos no TopDesk.
  app.post('/api/admin/topdesk-config/sync', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = await getCfg();
    if (!topdesk.isConfigured(cfg)) {
      reply.code(400);
      return { error: 'TopDesk não configurado' };
    }
    try {
      const result = await topdesk.applySync(prisma, cfg);
      await prisma.topDeskConfig.update({
        where: { id: 1 },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: result.ok ? 'ok' : 'error',
          lastSyncMessage: result.ok
            ? `criados ${result.created}, atualizados ${result.updated}`
            : `criados ${result.created}, atualizados ${result.updated} · ${result.errors.length} erro(s)`,
          lastSyncStats: {
            created: result.created,
            updated: result.updated,
            errors: result.errors.length,
          },
        },
      });
      await auditFromReq(req, {
        entity: 'topdesk_config',
        entityId: 1,
        action: 'sync',
        after: {
          created: result.created,
          updated: result.updated,
          errors: result.errors.length,
        },
      });
      return result;
    } catch (err) {
      reply.code(500);
      return { error: err.message };
    }
  });
}
