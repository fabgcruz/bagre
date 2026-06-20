// Endpoints admin pra configurar autenticação LDAP / Active Directory.
// Desligado por padrão — só responde quando um admin habilita.
// (Escrita já é bloqueada no DEMO_MODE pelo guard global em index.js.)

import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { auditFromReq } from '../audit.js';
import { getConfig, isConfigured, testConnection } from '../auth-providers/ldap.js';
import { redactForDemo } from '../demo-guard.js';

// Nunca devolve a senha do service account crua pra UI.
// Na demo, o "admin" é um visitante anônimo: também oculta a topologia interna
// (url do diretório, DN do service account, baseDn) — só vaza atributos genéricos.
function maskSecret(cfg) {
  if (!cfg) return cfg;
  const { bindPassword, ...rest } = cfg;
  return redactForDemo(
    { ...rest, hasBindPassword: !!bindPassword },
    ['url', 'bindDn', 'baseDn'],
  );
}

export async function registerLdapRoutes(app) {
  app.get('/api/admin/ldap-config', { preHandler: requireAdmin }, async () => {
    return maskSecret(await getConfig());
  });

  app.patch('/api/admin/ldap-config', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body || {};
    const data = {};
    const fields = [
      'enabled',
      'url',
      'startTls',
      'bindDn',
      'baseDn',
      'userFilter',
      'emailAttr',
      'nameAttr',
      'groupAttr',
      'adminGroups',
      'autoProvision',
      'defaultRole',
    ];
    for (const f of fields) {
      if (f in body) data[f] = body[f];
    }
    // bindPassword: só atualiza se vier um valor real (não o mascarado).
    if (body.bindPassword && !String(body.bindPassword).startsWith('••••')) {
      data.bindPassword = body.bindPassword;
    }
    const before = await getConfig();
    const after = await prisma.ldapConfig.update({ where: { id: 1 }, data });
    await auditFromReq(req, {
      entity: 'ldap_config',
      entityId: 1,
      action: 'update',
      before: maskSecret(before),
      after: maskSecret(after),
    });
    if (after.enabled && !isConfigured(after)) {
      reply.code(400);
      return {
        error: 'LDAP habilitado mas faltam campos obrigatórios (url, baseDn, userFilter).',
        config: maskSecret(after),
      };
    }
    return maskSecret(after);
  });

  app.post('/api/admin/ldap-config/test', { preHandler: requireAdmin }, async () => {
    const cfg = await getConfig();
    const result = await testConnection(cfg);
    await prisma.ldapConfig.update({
      where: { id: 1 },
      data: {
        lastTestedAt: new Date(),
        lastTestStatus: result.ok ? 'ok' : 'error',
        lastTestMessage: result.message,
      },
    });
    return result;
  });
}
