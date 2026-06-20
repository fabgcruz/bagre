#!/usr/bin/env node
// Pré-fiação do ambiente de demonstração (DEMO_MODE).
//
// Roda no boot do container `api` (depois de import.js, antes de index.js),
// SOMENTE quando DEMO_MODE=true. É idempotente — pode rodar a cada boot/reset.
//
//   1. Cria/atualiza usuários demo (admin + leitor) com senhas públicas de propósito.
//   2. Aponta a integração Zabbix para a instância in-stack (http://zabbix-web:8080).
//   3. Dispara uma sincronização inicial (com retry) para que os "pending
//      discoveries" já estejam presentes na primeira visita.
//
// Nunca derruba o boot: falhas de warm-up apenas logam; o scheduler do Zabbix
// (30s após o boot) recupera a sincronização sozinho.

import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { getConfig, syncFromZabbix } from '../src/integrations/zabbix.js';
import { getConfig as getPromConfig, syncFromPrometheus } from '../src/integrations/prometheus.js';
import * as powerdnsProvider from '../src/integrations/dns/powerdns.js';

const DEMO = process.env.DEMO_MODE === 'true';

const DEMO_ADMIN_EMAIL = process.env.DEMO_ADMIN_EMAIL || 'demo-admin@bagre.dev';
const DEMO_ADMIN_PASSWORD = process.env.DEMO_ADMIN_PASSWORD || 'demo-admin';
const DEMO_READER_EMAIL = process.env.DEMO_READER_EMAIL || 'demo-reader@bagre.dev';
const DEMO_READER_PASSWORD = process.env.DEMO_READER_PASSWORD || 'demo-reader';

const ZBX_URL = process.env.DEMO_ZABBIX_URL || 'http://zabbix-web:8080';
const ZBX_USER = process.env.DEMO_ZABBIX_USER || 'Admin';
const ZBX_PASS = process.env.DEMO_ZABBIX_PASS || 'zabbix';

const PROM_URL = process.env.DEMO_PROMETHEUS_URL || 'http://prometheus:9090';

const DNS_URL = process.env.DEMO_DNS_URL || 'http://powerdns:8081';
const DNS_KEY = process.env.DEMO_DNS_KEY || 'bagre-demo-key';
const DNS_ZONE = process.env.DEMO_DNS_ZONE || 'lab.local';

// LDAP/AD do demo — aponta pro OpenLDAP in-stack (interno, sem porta pública).
const LDAP_URL = process.env.DEMO_LDAP_URL || 'ldap://openldap:1389';
const LDAP_BIND_DN = process.env.DEMO_LDAP_BIND_DN || 'cn=admin,dc=corp,dc=local';
const LDAP_BIND_PW = process.env.DEMO_LDAP_BIND_PW || 'adminpw';
const LDAP_BASE_DN = process.env.DEMO_LDAP_BASE_DN || 'dc=corp,dc=local';
const LDAP_USER_FILTER = process.env.DEMO_LDAP_USER_FILTER || '(cn={username})';
const LDAP_ADMIN_GROUP = process.env.DEMO_LDAP_ADMIN_GROUP || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertDemoUser(email, password, role) {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: role === 'ADMIN' ? 'Demo Admin' : 'Demo Leitor',
      passwordHash,
      role,
      active: true,
      mustChangePwd: false,
      authProvider: 'local',
    },
    update: {
      passwordHash,
      role,
      active: true,
      mustChangePwd: false,
    },
  });
  console.log(`[demo-seed] usuário ${role}: ${user.email}`);
}

async function wireZabbix() {
  // Singleton id=1 — mesmo padrão de getConfig()/syncFromZabbix().
  await prisma.zabbixConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      enabled: true,
      url: ZBX_URL,
      username: ZBX_USER,
      password: ZBX_PASS,
      intervalMinutes: 15,
      groupFilter: [],
    },
    update: {
      enabled: true,
      url: ZBX_URL,
      username: ZBX_USER,
      password: ZBX_PASS,
    },
  });
  console.log(`[demo-seed] Zabbix fixado em ${ZBX_URL}`);
}

async function initialZabbixSync() {
  // O Zabbix web demora 30-90s no primeiro boot, e o serviço one-shot
  // `zabbix-seed` popula os hosts em paralelo. Tentamos até ter hosts;
  // se não vier a tempo, o scheduler recupera depois.
  const maxAttempts = 18; // ~3 min com backoff de 10s
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const cfg = await getConfig();
      const result = await syncFromZabbix(cfg);
      if (result?.hosts > 0) {
        console.log(`[demo-seed] sync Zabbix OK — ${result.hosts} hosts processados`);
        return;
      }
      console.log(
        `[demo-seed] tentativa ${attempt}/${maxAttempts}: Zabbix sem hosts ainda` +
          (result?.skipped ? ` (${result.reason})` : ''),
      );
    } catch (err) {
      console.log(`[demo-seed] tentativa ${attempt}/${maxAttempts}: ${err.message}`);
    }
    if (attempt < maxAttempts) await sleep(10_000);
  }
  console.warn('[demo-seed] sync inicial sem hosts após retries — o scheduler vai recuperar');
}

async function wirePrometheus() {
  await prisma.prometheusConfig.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: true, url: PROM_URL, authType: 'none', intervalMinutes: 15, jobFilter: [] },
    update: { enabled: true, url: PROM_URL, authType: 'none' },
  });
  console.log(`[demo-seed] Prometheus fixado em ${PROM_URL}`);
}

async function initialPrometheusSync() {
  // Prometheus + node-exporters levam alguns segundos pra ficar "up".
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const cfg = await getPromConfig();
      const result = await syncFromPrometheus(cfg);
      if (result?.targets > 0) {
        console.log(`[demo-seed] sync Prometheus OK — ${result.targets} targets`);
        return;
      }
      console.log(`[demo-seed] tentativa prom ${attempt}/${maxAttempts}: sem targets ainda`);
    } catch (err) {
      console.log(`[demo-seed] tentativa prom ${attempt}/${maxAttempts}: ${err.message}`);
    }
    if (attempt < maxAttempts) await sleep(10_000);
  }
  console.warn('[demo-seed] Prometheus sem targets após retries — o scheduler recupera');
}

async function wireDns() {
  await prisma.dnsConfig.upsert({
    where: { id: 1 },
    create: { id: 1, enabled: true, provider: 'powerdns', baseUrl: DNS_URL, apiKey: DNS_KEY, serverId: 'localhost', defaultZone: DNS_ZONE, intervalMinutes: 60 },
    update: { enabled: true, provider: 'powerdns', baseUrl: DNS_URL, apiKey: DNS_KEY, serverId: 'localhost', defaultZone: DNS_ZONE },
  });
  console.log(`[demo-seed] DNS (PowerDNS) fixado em ${DNS_URL} · zona ${DNS_ZONE}`);
}

async function wireLdap() {
  await prisma.ldapConfig.upsert({
    where: { id: 1 },
    create: {
      id: 1, enabled: true, url: LDAP_URL, bindDn: LDAP_BIND_DN, bindPassword: LDAP_BIND_PW,
      baseDn: LDAP_BASE_DN, userFilter: LDAP_USER_FILTER,
      emailAttr: 'mail', nameAttr: 'cn', groupAttr: 'memberOf',
      adminGroups: LDAP_ADMIN_GROUP ? [LDAP_ADMIN_GROUP] : [],
      autoProvision: true, defaultRole: 'READER',
    },
    update: {
      enabled: true, url: LDAP_URL, bindDn: LDAP_BIND_DN, bindPassword: LDAP_BIND_PW,
      baseDn: LDAP_BASE_DN, userFilter: LDAP_USER_FILTER,
      adminGroups: LDAP_ADMIN_GROUP ? [LDAP_ADMIN_GROUP] : [],
    },
  });
  console.log(`[demo-seed] LDAP/AD fixado em ${LDAP_URL} · base ${LDAP_BASE_DN}`);
}

async function initialDnsSync() {
  // PowerDNS leva alguns segundos pra subir (init do sqlite + zona).
  const maxAttempts = 12;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const cfg = await prisma.dnsConfig.findUnique({ where: { id: 1 } });
      const t = await powerdnsProvider.testConnection(cfg);
      if (t.ok) {
        const r = await powerdnsProvider.applySync(prisma, cfg);
        await prisma.dnsConfig.update({
          where: { id: 1 },
          data: {
            lastTestedAt: new Date(), lastTestStatus: 'ok', lastTestMessage: t.message,
            lastSyncAt: new Date(), lastSyncStatus: 'ok',
            lastSyncMessage: `aplicado ${r.applied} RRsets`,
            lastSyncStats: { applied: r.applied, created: r.toCreate.length, updated: r.toUpdate.length, deleted: r.toDelete.length },
          },
        });
        console.log(`[demo-seed] DNS sync OK — ${r.applied} RRsets na zona ${DNS_ZONE}`);
        return;
      }
      console.log(`[demo-seed] tentativa dns ${attempt}/${maxAttempts}: ${t.message}`);
    } catch (err) {
      console.log(`[demo-seed] tentativa dns ${attempt}/${maxAttempts}: ${err.message}`);
    }
    if (attempt < maxAttempts) await sleep(10_000);
  }
  console.warn('[demo-seed] DNS sync não completou — verifique o PowerDNS');
}

// Dados base fictícios para a demo não começar vazia. Faixas escolhidas para
// NÃO colidir com os IPs descobertos no Zabbix (10.150/10.230/192.168.110-111/
// 172.16.99) — assim as descobertas continuam pendentes para aprovação.
const BASE_SITES = [
  {
    code: 'SP-MATRIZ', name: 'Matriz — São Paulo',
    description: 'Sede administrativa e datacenter on-premises principal.',
    subnets: [
      { name: 'Servidores — Matriz', cidr: '10.0.0.0/24', vlanId: 10, ips: [
        { a: '10.0.0.1', h: 'gw-core-sp', s: 'RESERVED', role: 'Gateway' },
        { a: '10.0.0.10', h: 'srv-web-01', s: 'USED', type: 'Servidor Linux', os: 'Ubuntu 22.04 LTS', vendor: 'Dell', model: 'PowerEdge R750', role: 'Web Server' },
        { a: '10.0.0.11', h: 'srv-web-02', s: 'USED', type: 'Servidor Linux', os: 'Ubuntu 22.04 LTS', vendor: 'Dell', model: 'PowerEdge R750', role: 'Web Server' },
        { a: '10.0.0.20', h: 'srv-db-01', s: 'USED', type: 'Servidor Linux', os: 'Red Hat Enterprise Linux 9', vendor: 'HP', model: 'ProLiant DL380', role: 'Banco de Dados' },
        { a: '10.0.0.30', h: 'srv-app-01', s: 'USED', type: 'Servidor Linux', os: 'Debian 12', vendor: 'Dell', model: 'PowerEdge R650', role: 'Aplicação' },
        { a: '10.0.0.50', h: null, s: 'RESERVED', note: 'Reservado para expansão' },
      ] },
      { name: 'Estações — Matriz', cidr: '10.0.20.0/24', vlanId: 20, ips: [
        { a: '10.0.20.10', h: 'ws-financeiro-01', s: 'USED', type: 'Workstation', os: 'Windows 11 Pro', vendor: 'Lenovo', model: 'ThinkCentre M70' },
        { a: '10.0.20.11', h: 'ws-rh-01', s: 'USED', type: 'Workstation', os: 'Windows 11 Pro', vendor: 'Dell', model: 'OptiPlex 7010' },
      ] },
      { name: 'Gerência de Rede — Matriz', cidr: '192.168.1.0/24', vlanId: 99, ips: [
        { a: '192.168.1.1', h: 'sw-core-sp-01', s: 'USED', type: 'Switch', os: 'Cisco IOS 17.6', vendor: 'Cisco', model: 'Catalyst 9300', role: 'Switch Core' },
        { a: '192.168.1.2', h: 'fw-perimetro-sp', s: 'USED', type: 'Firewall', os: 'FortiOS 7.4', vendor: 'Fortinet', model: 'FortiGate 200F', role: 'Firewall' },
      ] },
    ],
  },
  {
    code: 'RJ-FILIAL', name: 'Filial — Rio de Janeiro',
    description: 'Escritório regional.',
    subnets: [
      { name: 'Servidores — Filial RJ', cidr: '10.1.0.0/24', vlanId: 10, ips: [
        { a: '10.1.0.1', h: 'gw-rj', s: 'RESERVED', role: 'Gateway' },
        { a: '10.1.0.10', h: 'srv-arquivos-rj', s: 'USED', type: 'Servidor Windows', os: 'Windows Server 2022', vendor: 'Dell', model: 'PowerEdge T440', role: 'File Server' },
        { a: '10.1.0.20', h: 'srv-bkp-rj', s: 'USED', type: 'Servidor Linux', os: 'Ubuntu 22.04 LTS', vendor: 'HP', model: 'ProLiant DL360', role: 'Backup' },
      ] },
    ],
  },
  {
    code: 'DC-CAMPINAS', name: 'Datacenter — Campinas',
    description: 'Datacenter de colocation.',
    subnets: [
      { name: 'Servidores — DC', cidr: '172.16.10.0/24', vlanId: 100, ips: [
        { a: '172.16.10.10', h: 'srv-k8s-01', s: 'USED', type: 'Servidor Linux', os: 'Ubuntu 24.04 LTS', vendor: 'Dell', model: 'PowerEdge R760', role: 'Kubernetes Node' },
        { a: '172.16.10.11', h: 'srv-k8s-02', s: 'USED', type: 'Servidor Linux', os: 'Ubuntu 24.04 LTS', vendor: 'Dell', model: 'PowerEdge R760', role: 'Kubernetes Node' },
        { a: '172.16.10.12', h: 'srv-k8s-03', s: 'USED', type: 'Servidor Linux', os: 'Ubuntu 24.04 LTS', vendor: 'Dell', model: 'PowerEdge R760', role: 'Kubernetes Node' },
      ] },
      { name: 'Storage e Backup — DC', cidr: '172.16.20.0/24', vlanId: 200, ips: [
        { a: '172.16.20.10', h: 'san-01', s: 'USED', type: 'Storage', vendor: 'Dell', model: 'PowerStore 500T', role: 'SAN' },
        { a: '172.16.20.20', h: null, s: 'RESERVED', note: 'Reservado para replicação' },
      ] },
    ],
  },
];

async function seedBaseData() {
  // Se já há dados base, não re-semeia (evita duplicar em restart sem reset).
  if (await prisma.site.findUnique({ where: { code: 'SP-MATRIZ' } })) {
    console.log('[demo-seed] dados base já presentes — pulando.');
    return;
  }
  let nSites = 0, nSubnets = 0, nIps = 0, nDevices = 0;
  for (const s of BASE_SITES) {
    const site = await prisma.site.create({
      data: { code: s.code, name: s.name, description: s.description },
    });
    nSites++;
    for (const sn of s.subnets) {
      const subnet = await prisma.subnet.create({
        data: { siteId: site.id, name: sn.name, cidr: sn.cidr, vlanId: sn.vlanId ?? null, source: 'demo' },
      });
      nSubnets++;
      for (const ip of sn.ips) {
        let deviceId = null;
        if (ip.s === 'USED' && ip.h) {
          const dev = await prisma.device.create({
            data: { name: ip.h, type: ip.type ?? null, vendor: ip.vendor ?? null, model: ip.model ?? null, osInfo: ip.os ?? null, role: ip.role ?? null, siteId: site.id },
          });
          deviceId = dev.id;
          nDevices++;
        }
        await prisma.ipAddress.create({
          data: {
            subnetId: subnet.id, address: ip.a, hostname: ip.h ?? null, status: ip.s,
            type: ip.type ?? null, osInfo: ip.os ?? null, vendor: ip.vendor ?? null, model: ip.model ?? null,
            function: ip.role ?? null, notes: ip.note ?? null, deviceId, source: 'demo',
          },
        });
        nIps++;
      }
    }
  }
  console.log(`[demo-seed] dados base: ${nSites} sites, ${nSubnets} subnets, ${nIps} IPs, ${nDevices} devices`);
}

// Catálogos de referência (Ranges Mestre + VLANs de datacenter). Exemplos
// neutros pra a tela não aparecer vazia no demo. Idempotente.
async function wireCatalogs() {
  const ranges = [
    { cidr: '10.0.0.0/8', description: 'Rede corporativa (RFC1918)', category: 'Corporativo' },
    { cidr: '10.20.0.0/16', description: 'Datacenter Principal', category: 'Datacenter' },
    { cidr: '172.16.0.0/12', description: 'Ambientes cloud (VPCs)', category: 'Cloud' },
    { cidr: '192.168.0.0/16', description: 'Filiais e escritórios', category: 'WAN' },
    { cidr: '100.64.0.0/10', description: 'CGNAT / links de operadora', category: 'Links' },
  ];
  for (const r of ranges) {
    await prisma.masterRange.upsert({
      where: { cidr_description: { cidr: r.cidr, description: r.description } },
      create: r,
      update: { category: r.category },
    });
  }
  if ((await prisma.datacenterVlan.count()) === 0) {
    await prisma.datacenterVlan.createMany({
      data: [
        { name: 'VLAN 100 — Servidores', provider: 'Datacenter Principal', vlanId: 100, network: '10.20.100.0/24', usage: 'Servidores físicos' },
        { name: 'VLAN 200 — Virtualização', provider: 'Datacenter Principal', vlanId: 200, network: '10.20.200.0/24', usage: 'Hosts de virtualização' },
        { name: 'VLAN 300 — Storage', provider: 'Colocation SP', vlanId: 300, network: '10.20.30.0/24', usage: 'Rede de storage (iSCSI)' },
        { name: 'VLAN 400 — DMZ', provider: 'Colocation RJ', vlanId: 400, network: '10.20.40.0/24', usage: 'DMZ / borda' },
      ],
    });
  }
  console.log('[demo-seed] catálogos: 5 ranges mestre + 4 VLANs de datacenter');
}

async function main() {
  if (!DEMO) {
    console.log('[demo-seed] DEMO_MODE != true — nada a fazer.');
    return;
  }
  console.log('[demo-seed] preparando ambiente de demonstração…');
  await upsertDemoUser(DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD, 'ADMIN');
  await upsertDemoUser(DEMO_READER_EMAIL, DEMO_READER_PASSWORD, 'READER');
  await seedBaseData();
  await wireCatalogs();
  await wireZabbix();
  await wirePrometheus();
  await wireDns();
  await wireLdap();
  await initialZabbixSync();
  await initialPrometheusSync();
  await initialDnsSync();
  console.log('[demo-seed] concluído.');
}

main()
  .catch((err) => {
    // Nunca falha o boot — apenas registra.
    console.error('[demo-seed] erro (ignorado para não bloquear o boot):', err.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
