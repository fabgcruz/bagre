import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { auditFromReq } from '../audit.js';
import {
  getConfig,
  testConnection,
  syncFromPrometheus,
} from '../integrations/prometheus.js';
import { redactForDemo } from '../demo-guard.js';
import { assertSafeIntegrationUrl } from '../lib/ssrf-guard.js';

const SAFE_FIELDS = [
  'enabled',
  'url',
  'authType',
  'bearerToken',
  'basicUsername',
  'basicPassword',
  'intervalMinutes',
  'jobFilter',
  'staleAfterDays',
];

// Placeholder fixo — NUNCA revelar parte do segredo. O front usa hasBearerToken/hasBasicPassword.
const MASK = '••••••••';

function safeView(cfg) {
  if (!cfg) return cfg;
  const view = {
    ...cfg,
    bearerToken: cfg.bearerToken ? MASK : null,
    basicPassword: cfg.basicPassword ? MASK : null,
    hasBearerToken: !!cfg.bearerToken,
    hasBasicPassword: !!cfg.basicPassword,
  };
  // Na demo, o "admin" é anônimo: não vazar host/usuário internos.
  return redactForDemo(view, ['url', 'basicUsername']);
}

export async function registerPrometheusRoutes(app) {
  app.get('/api/admin/prometheus-config', { preHandler: requireAdmin }, async () => {
    const cfg = await getConfig();
    return safeView(cfg);
  });

  app.patch('/api/admin/prometheus-config', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    const data = {};
    for (const f of SAFE_FIELDS) {
      if (f in body) data[f] = body[f];
    }
    // Não sobrescreve secrets quando vem mascarado da UI
    if (data.bearerToken && String(data.bearerToken).startsWith('••••')) delete data.bearerToken;
    if (data.basicPassword && String(data.basicPassword).startsWith('••••')) delete data.basicPassword;
    if ('bearerToken' in data && data.bearerToken === '') data.bearerToken = null;
    if ('basicPassword' in data && data.basicPassword === '') data.basicPassword = null;
    // Anti-SSRF: rejeita URL apontando pra metadata/link-local.
    if (data.url) {
      try {
        await assertSafeIntegrationUrl(data.url);
      } catch (e) {
        reply.code(400);
        return { error: `URL do Prometheus rejeitada: ${e.message}` };
      }
    }
    const before = await getConfig();
    const after = await prisma.prometheusConfig.update({ where: { id: 1 }, data });
    await auditFromReq(req, {
      entity: 'prometheus_config',
      entityId: 1,
      action: 'update',
      before: safeView(before),
      after: safeView(after),
    });
    return safeView(after);
  });

  app.post('/api/admin/prometheus-config/test', { preHandler: requireAdmin }, async () => {
    const cfg = await getConfig();
    const result = await testConnection(cfg);
    await prisma.prometheusConfig.update({
      where: { id: 1 },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : 'error',
        lastTestMessage: result.message,
      },
    });
    return result;
  });

  app.post('/api/admin/prometheus-config/sync', { preHandler: requireAdmin }, async (req, reply) => {
    const cfg = await getConfig();
    if (!cfg.url) {
      reply.code(400);
      return { error: 'configure a URL antes de sincronizar' };
    }
    try {
      const result = await syncFromPrometheus({ ...cfg, enabled: true });
      await auditFromReq(req, {
        entity: 'prometheus_config',
        entityId: 1,
        action: 'sync',
        after: result,
      });
      return result;
    } catch (err) {
      reply.code(500);
      return { error: err.message };
    }
  });
}
