import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';

import { prisma } from './db.js';
import { ensureBootstrapAdmin, requireAuth, requireAdmin } from './auth.js';
import { DEMO } from './demo-guard.js';
import { registerSites } from './routes/sites.js';
import { registerSubnets } from './routes/subnets.js';
import { registerIps } from './routes/ips.js';
import { registerSearch } from './routes/search.js';
import { registerCatalogs } from './routes/catalogs.js';
import { registerImport } from './routes/import.js';
import { registerStats } from './routes/stats.js';
import { registerIngest } from './routes/ingest.js';
import { registerMetrics } from './routes/metrics.js';
import { registerAuth } from './routes/auth.js';
import { registerUsers } from './routes/users.js';
import { registerDevices } from './routes/devices.js';
import { registerPendingDiscoveries } from './routes/pending-discoveries.js';
import { registerAuditRoutes } from './routes/audit.js';
import { registerOidcRoutes } from './routes/oidc.js';
import { registerLdapRoutes } from './routes/ldap.js';
import { registerZabbixRoutes } from './routes/zabbix.js';
import { registerPrometheusRoutes } from './routes/prometheus.js';
import { registerCidrRoutes } from './routes/cidr.js';
import { registerDnsRoutes } from './routes/dns.js';
import { registerValidationRoutes } from './routes/validation.js';
import { registerNetworkHealthRoutes } from './routes/network-health.js';
import { registerIntegrationsStatusRoutes } from './routes/integrations-status.js';
import { registerCloudAccountRoutes } from './routes/cloud-accounts.js';
import { registerCloudFinOpsRoutes } from './routes/cloud-finops.js';
import { startScheduler as startZabbixScheduler } from './integrations/zabbix.js';
import { startScheduler as startPrometheusScheduler } from './integrations/prometheus.js';
import { startScheduler as startSnapshotScheduler } from './integrations/utilization-snapshot.js';

const PORT = Number(process.env.PORT || 3001);

async function build() {
  // trustProxy: atrás do nginx/reverse-proxy (demo, self-host), faz req.ip
  // refletir o cliente real via X-Forwarded-For — necessário pro rate-limit.
  const app = Fastify({ logger: { level: 'info' }, trustProxy: true });

  // CORS: se CORS_ORIGIN for definido (lista separada por vírgula), só essas
  // origens são aceitas — em produção/demo, evita refletir qualquer Origin com
  // credentials. Sem a env (dev), reflete a origem pra conveniência local.
  const corsAllow = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: corsAllow.length ? corsAllow : true,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  // JWT_SECRET é fail-closed: sem env definido ou abaixo de 32 chars, o boot
  // aborta. Segredos fracos permitem forjar tokens; melhor cair barulhento.
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET ausente ou com menos de 32 chars. Gere uma chave forte com: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"',
    );
  }
  if (/please-change|change-me|dev-secret/i.test(jwtSecret)) {
    throw new Error(
      'JWT_SECRET ainda tem o valor de exemplo. Troque por uma chave forte aleatória antes de subir.',
    );
  }
  await app.register(jwt, { secret: jwtSecret });

  app.decorate('requireAuth', requireAuth);
  app.decorate('requireAdmin', requireAdmin);

  await ensureBootstrapAdmin(app.log);

  // Public paths (no auth required). /api/import/seed and /api/ingest/* are
  // handled by their own token-based auth so that automated tooling can call
  // them without a user JWT.
  const PUBLIC = new Set([
    '/api/health',
    '/api/config',
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/reset-request',
    '/api/auth/reset',
    '/api/auth/sso/start',
    '/api/auth/sso/callback',
    '/api/import/seed',
    '/api/ingest/discoveries',
    '/api/ingest/heartbeat',
    '/metrics',
  ]);
  // Lab/dev only: deixa /api/stats público quando STATS_PUBLIC=true. Padrão off.
  if (process.env.STATS_PUBLIC === 'true') PUBLIC.add('/api/stats');

  // Global guard — applies on every request before handlers run
  app.addHook('onRequest', async (req, reply) => {
    const url = req.routeOptions?.url || req.url.split('?')[0];
    // Only protect /api/* paths
    if (!url.startsWith('/api/')) return;

    // DEMO_MODE = ambiente público SOMENTE LEITURA. Bloqueia toda escrita
    // (POST/PUT/PATCH/DELETE) — exceto o login — pra que nenhum visitante,
    // nem como "admin", crie/altere/remova recursos ou as próprias contas demo.
    // Cobre rotas públicas-de-escrita (signup/reset/ingest) e autenticadas.
    // O seed e os syncs rodam in-process (não via HTTP), então não são afetados.
    if (
      DEMO &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      url !== '/api/auth/login'
    ) {
      reply.code(403).send({
        error: 'demo_mode_readonly',
        detail: 'Ambiente de demonstração é somente leitura.',
      });
      return reply;
    }

    if (PUBLIC.has(url)) return;
    // Auth
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'unauthorized' });
      return reply;
    }
    const id = Number(req.user?.sub);
    if (!id) {
      reply.code(401).send({ error: 'invalid token' });
      return reply;
    }
    const dbUser = await prisma.user.findUnique({ where: { id } });
    if (!dbUser || !dbUser.active) {
      reply.code(401).send({ error: 'user inactive' });
      return reply;
    }
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      name: dbUser.name,
      mustChangePwd: dbUser.mustChangePwd,
      // Origem da autenticação (local/ldap/oidc) + DN/grupos do diretório — usado
      // pela UI pra mostrar "Autenticado via LDAP/AD". Não-sensível.
      authProvider: dbUser.authProvider || 'local',
      externalId: dbUser.externalId || null,
      externalGroups: dbUser.externalGroups || [],
    };
    // Write methods require ADMIN — except change-password & user-self routes
    const adminOnlyForWrites = !(
      url === '/api/auth/change-password' || url === '/api/auth/me'
    );
    if (
      adminOnlyForWrites &&
      ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) &&
      dbUser.role !== 'ADMIN'
    ) {
      reply.code(403).send({ error: 'forbidden — requer perfil ADMIN' });
      return reply;
    }
  });

  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  await registerAuth(app);
  await registerUsers(app);
  await registerDevices(app);
  await registerPendingDiscoveries(app);
  await registerAuditRoutes(app);
  await registerOidcRoutes(app);
  await registerLdapRoutes(app);
  await registerZabbixRoutes(app);
  await registerPrometheusRoutes(app);
  await registerCidrRoutes(app);
  await registerDnsRoutes(app);
  await registerValidationRoutes(app);
  await registerNetworkHealthRoutes(app);
  await registerIntegrationsStatusRoutes(app);
  await registerCloudAccountRoutes(app);
  await registerCloudFinOpsRoutes(app);
  // Background scheduler (non-blocking)
  startZabbixScheduler(app.log).catch((e) => app.log.warn(e, 'zabbix scheduler init failed'));
  startPrometheusScheduler(app.log).catch((e) => app.log.warn(e, 'prometheus scheduler init failed'));
  startSnapshotScheduler(app.log).catch((e) => app.log.warn(e, 'utilization snapshot scheduler init failed'));

  await registerStats(app);
  await registerSites(app);
  await registerSubnets(app);
  await registerIps(app);
  await registerSearch(app);
  await registerCatalogs(app);
  await registerImport(app);
  await registerIngest(app);
  await registerMetrics(app);

  app.setErrorHandler((err, req, reply) => {
    req.log.error(err);
    reply.code(err.statusCode || 500).send({ error: err.message });
  });

  return app;
}

build()
  .then(async (app) => {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`API listening on :${PORT}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
