import { prisma } from '../db.js';
import { requireAdmin } from '../auth.js';
import { testConnection as testZabbix, getConfig as getZabbixCfg, isConfigured as isZabbixConfigured } from '../integrations/zabbix.js';
import { getConfig as getPromCfg, isConfigured as isPromConfigured } from '../integrations/prometheus.js';
import * as powerdns from '../integrations/dns/powerdns.js';
import { getConfig as getOidcCfg, isConfigured as isOidcConfigured, testDiscovery as testOidc } from '../auth-providers/oidc.js';
import { getConfig as getLdapCfg, isConfigured as isLdapConfigured } from '../auth-providers/ldap.js';

function ageMs(date) {
  if (!date) return null;
  return Date.now() - new Date(date).getTime();
}

async function zabbixStatus() {
  const cfg = await getZabbixCfg();
  const configured = isZabbixConfigured(cfg);
  const ipsTouched = await prisma.ipAddress.count({ where: { lastSeenSource: 'zabbix' } });
  return {
    key: 'zabbix',
    name: 'Zabbix',
    icon: '📡',
    description: 'Puxa os hosts do seu Zabbix. Os que ainda não estão no IPAM viram pendências pra aprovar em Aprovações.',
    configured,
    enabled: cfg.enabled,
    lastTest: cfg.lastTestedAt
      ? { at: cfg.lastTestedAt, ok: cfg.lastTestStatus === 'ok', message: cfg.lastTestMessage }
      : null,
    lastSync: cfg.lastSyncAt
      ? { at: cfg.lastSyncAt, ok: cfg.lastSyncStatus === 'ok', message: cfg.lastSyncMessage, stats: cfg.lastSyncStats }
      : null,
    ipsTouched,
    intervalMinutes: cfg.intervalMinutes,
    configUrl: '/admin/integrations/zabbix',
    healthEndpoint: '/api/admin/zabbix-config/test',
  };
}

async function prometheusStatus() {
  const cfg = await getPromCfg();
  const configured = isPromConfigured(cfg);
  const ipsTouched = await prisma.ipAddress.count({ where: { lastSeenSource: 'prometheus' } });
  return {
    key: 'prometheus',
    name: 'Prometheus',
    icon: '🔥',
    description: 'Descobre hosts pelos targets do Prometheus e os traz pra aprovar em Aprovações. Ideal pra ambiente cloud-native.',
    configured,
    enabled: cfg.enabled,
    lastTest: cfg.lastTestedAt
      ? { at: cfg.lastTestedAt, ok: cfg.lastTestStatus === 'ok', message: cfg.lastTestMessage }
      : null,
    lastSync: cfg.lastSyncAt
      ? { at: cfg.lastSyncAt, ok: cfg.lastSyncStatus === 'ok', message: cfg.lastSyncMessage, stats: cfg.lastSyncStats }
      : null,
    ipsTouched,
    intervalMinutes: cfg.intervalMinutes,
    configUrl: '/admin/integrations/prometheus',
    healthEndpoint: '/api/admin/prometheus-config/test',
  };
}

async function dnsStatus() {
  let cfg = await prisma.dnsConfig.findUnique({ where: { id: 1 } });
  if (!cfg) cfg = await prisma.dnsConfig.create({ data: { id: 1 } });
  const configured = powerdns.isConfigured(cfg);
  return {
    key: 'dns',
    name: cfg.provider === 'powerdns' ? 'PowerDNS' : (cfg.provider || 'DNS'),
    icon: '🌐',
    description: 'Publica os hostnames do IPAM no DNS automaticamente — seu DNS sempre em sincronia, sem editar zona na mão.',
    configured,
    enabled: cfg.enabled,
    lastTest: cfg.lastTestedAt
      ? { at: cfg.lastTestedAt, ok: cfg.lastTestStatus === 'ok', message: cfg.lastTestMessage }
      : null,
    lastSync: cfg.lastSyncAt
      ? { at: cfg.lastSyncAt, ok: cfg.lastSyncStatus === 'ok', message: cfg.lastSyncMessage, stats: cfg.lastSyncStats }
      : null,
    intervalMinutes: cfg.intervalMinutes,
    configUrl: '/admin/integrations/dns',
    healthEndpoint: '/api/admin/dns-config/test',
  };
}

async function oidcStatus() {
  const cfg = await getOidcCfg();
  const configured = isOidcConfigured(cfg);
  return {
    key: 'oidc',
    name: 'Login único (SSO)',
    icon: '🔑',
    description: 'Login corporativo via SSO — Microsoft Entra ID, Google, Keycloak ou qualquer provedor OIDC.',
    configured,
    enabled: cfg.enabled,
    lastTest: cfg.lastTestedAt
      ? { at: cfg.lastTestedAt, ok: cfg.lastTestStatus === 'ok', message: cfg.lastTestMessage }
      : null,
    configUrl: '/admin/sso',
    healthEndpoint: '/api/admin/oidc-config/test',
  };
}

async function ldapStatus() {
  const cfg = await getLdapCfg();
  const configured = isLdapConfigured(cfg);
  return {
    key: 'ldap',
    name: 'Autenticação AD/LDAP',
    icon: '🏢',
    description:
      'Login com Active Directory / LDAP on-premise — papel (ADMIN/READER) mapeado pelos grupos do diretório.',
    configured,
    enabled: cfg.enabled,
    lastTest: cfg.lastTestedAt
      ? { at: cfg.lastTestedAt, ok: cfg.lastTestStatus === 'ok', message: cfg.lastTestMessage }
      : null,
    configUrl: '/admin/ldap',
    healthEndpoint: '/api/admin/ldap-config/test',
  };
}

function deriveOverall(integrations) {
  const errors = integrations.filter(
    (i) => i.enabled && (i.lastTest?.ok === false || i.lastSync?.ok === false),
  );
  if (errors.length) return { tone: 'error', label: 'Atenção · com erros' };
  const enabled = integrations.filter((i) => i.enabled && i.configured).length;
  if (enabled === 0) {
    const anyConfigured = integrations.some((i) => i.configured);
    return anyConfigured
      ? { tone: 'warn', label: 'Configurado mas pausado' }
      : { tone: 'idle', label: 'Nenhuma integração ativa' };
  }
  // Stale check: any enabled integration without recent sync within 2× interval
  const stale = integrations.find((i) => {
    if (!i.enabled) return false;
    if (!i.lastSync?.at) return true;
    const age = ageMs(i.lastSync.at);
    const limit = (i.intervalMinutes || 15) * 60_000 * 2;
    return age > limit;
  });
  if (stale) return { tone: 'warn', label: 'Sincronização atrasada' };
  return { tone: 'ok', label: 'Tudo operando' };
}

export async function registerIntegrationsStatusRoutes(app) {
  app.get('/api/admin/integrations/status', { preHandler: requireAdmin }, async () => {
    const [zabbix, prometheus, dns, oidc, ldap, events] = await Promise.all([
      zabbixStatus(),
      prometheusStatus(),
      dnsStatus(),
      oidcStatus(),
      ldapStatus(),
      prisma.auditLog.findMany({
        where: {
          OR: [
            { entity: 'zabbix_config' },
            { entity: 'prometheus_config' },
            { entity: 'dns_config' },
            { entity: 'oidc_config' },
            { entity: 'ldap_config' },
            { entity: 'user', action: 'login' },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);
    const integrations = [zabbix, prometheus, dns, oidc, ldap];
    const overall = deriveOverall(integrations);
    return { overall, integrations, events };
  });
}
