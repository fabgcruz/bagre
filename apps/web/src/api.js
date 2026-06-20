const BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'bagre.token';

export const auth = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Trava de demonstração (somente-leitura). Ligada pelo Layout quando
// /api/config diz demo.enabled. Defesa em profundidade: a API já bloqueia toda
// escrita no DEMO_MODE; aqui barramos no cliente ANTES de enviar, pra nenhum
// botão (atual ou futuro) conseguir apagar/alterar nada — e avisamos o usuário.
let demoMode = false;
export function setDemoMode(v) {
  demoMode = !!v;
}
let onDemoBlock = () => {};
export function setDemoBlockHandler(fn) {
  onDemoBlock = fn;
}
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Guard para ações com INTENÇÃO de escrita que NÃO são chamadas de API por si só
// — abrir um modal de criar/editar, ou um fluxo de excluir com confirmação. No
// demo, mostra o aviso na hora e devolve true (= bloqueado), pra UI abortar antes
// de abrir o formulário. Fora do demo devolve false (segue normal).
// Uso típico:  onClick={() => { if (demoTryWrite()) return; abrirModal(); }}
export function demoTryWrite() {
  if (demoMode) {
    onDemoBlock();
    return true;
  }
  return false;
}
export function isDemoMode() {
  return demoMode;
}

async function request(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  // Login é o único write permitido na demo (é como o visitante entra).
  if (demoMode && WRITE_METHODS.has(method) && path !== '/auth/login') {
    onDemoBlock();
    const err = new Error('Ambiente de demonstração: somente leitura.');
    err.demoBlocked = true;
    throw err;
  }
  const headers = { ...(opts.headers || {}) };
  // Only set JSON content-type when there's actually a body to send.
  // Fastify rejects requests with content-type set but empty body.
  if (opts.body) headers['Content-Type'] = 'application/json';
  const token = auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    auth.clear();
    onUnauthorized();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j.error || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signup: (data) =>
    request('/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  resetRequest: (email) =>
    request('/auth/reset-request', { method: 'POST', body: JSON.stringify({ email }) }),
  resetApply: (token, newPassword) =>
    request('/auth/reset', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),

  // users (admin)
  users: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) =>
    request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  resetUser: (id) => request(`/users/${id}/reset`, { method: 'POST' }),

  // devices (equipamentos)
  devices: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/devices${qs ? `?${qs}` : ''}`);
  },
  device: (id) => request(`/devices/${id}`),
  createDevice: (data) => request('/devices', { method: 'POST', body: JSON.stringify(data) }),
  updateDevice: (id, data) =>
    request(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDevice: (id) => request(`/devices/${id}`, { method: 'DELETE' }),

  // allocation
  allocateIp: (ipId, payload) =>
    request(`/ips/${ipId}/allocate`, { method: 'POST', body: JSON.stringify(payload) }),
  subnetNextFreeIp: (subnetId) => request(`/subnets/${subnetId}/next-free-ip`),

  // pending discoveries (Zabbix gate)
  pendingDiscoveries: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/pending-discoveries${qs ? `?${qs}` : ''}`);
  },
  pendingDiscoveriesStats: () => request('/pending-discoveries/stats'),
  approvePendingDiscovery: (id, payload) =>
    request(`/pending-discoveries/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  rejectPendingDiscovery: (id, payload) =>
    request(`/pending-discoveries/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  bulkApprovePendingDiscoveries: (payload) =>
    request(`/pending-discoveries/bulk-approve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // sites + subnets CRUD
  createSite: (data) => request('/sites', { method: 'POST', body: JSON.stringify(data) }),
  updateSite: (id, data) =>
    request(`/sites/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSite: (id) => request(`/sites/${id}`, { method: 'DELETE' }),
  createSubnet: (data) =>
    request('/subnets', { method: 'POST', body: JSON.stringify(data) }),
  updateSubnet: (id, data) =>
    request(`/subnets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSubnet: (id) => request(`/subnets/${id}`, { method: 'DELETE' }),

  // audit
  audit: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/audit${qs ? `?${qs}` : ''}`);
  },
  auditEntities: () => request('/audit/entities'),

  // Integrações
  integrationsStatus: () => request('/admin/integrations/status'),

  // Zabbix
  zabbixConfig: () => request('/admin/zabbix-config'),
  updateZabbixConfig: (data) =>
    request('/admin/zabbix-config', { method: 'PATCH', body: JSON.stringify(data) }),
  testZabbixConfig: () => request('/admin/zabbix-config/test', { method: 'POST' }),
  syncZabbix: () => request('/admin/zabbix-config/sync', { method: 'POST' }),

  // Prometheus
  prometheusConfig: () => request('/admin/prometheus-config'),
  updatePrometheusConfig: (data) =>
    request('/admin/prometheus-config', { method: 'PATCH', body: JSON.stringify(data) }),
  testPrometheusConfig: () => request('/admin/prometheus-config/test', { method: 'POST' }),
  syncPrometheus: () => request('/admin/prometheus-config/sync', { method: 'POST' }),

  // DNS (PowerDNS)
  dnsConfig: () => request('/admin/dns-config'),
  updateDnsConfig: (data) =>
    request('/admin/dns-config', { method: 'PATCH', body: JSON.stringify(data) }),
  testDnsConfig: () => request('/admin/dns-config/test', { method: 'POST' }),
  dnsPreview: () => request('/admin/dns-config/preview'),
  dnsSync: () => request('/admin/dns-config/sync', { method: 'POST' }),

  // Validation rules
  validationRules: () => request('/validation/rules'),
  validationRuleTypes: () => request('/validation/rule-types'),
  createValidationRule: (data) =>
    request('/validation/rules', { method: 'POST', body: JSON.stringify(data) }),
  updateValidationRule: (id, data) =>
    request(`/validation/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteValidationRule: (id) =>
    request(`/validation/rules/${id}`, { method: 'DELETE' }),
  testSubnetValidation: (candidate) =>
    request('/validation/test-subnet', { method: 'POST', body: JSON.stringify(candidate) }),

  // Network health
  networkHealth: () => request('/network-health'),

  // SSO / OIDC
  config: () => request('/config'),
  oidcConfig: () => request('/admin/oidc-config'),
  updateOidcConfig: (data) =>
    request('/admin/oidc-config', { method: 'PATCH', body: JSON.stringify(data) }),
  testOidcConfig: () =>
    request('/admin/oidc-config/test', { method: 'POST' }),

  health: () => request('/health'),
  stats: () => request('/stats'),
  statsBySite: () => request('/stats/by-site'),

  sites: () => request('/sites'),
  site: (id) => request(`/sites/${id}`),

  subnet: (id) => request(`/subnets/${id}`),
  subnetIps: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/subnets/${id}/ips${qs ? `?${qs}` : ''}`);
  },

  updateIp: (id, data) =>
    request(`/ips/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  releaseIp: (id) => request(`/ips/${id}/release`, { method: 'POST' }),
  reserveIp: (id) => request(`/ips/${id}/reserve`, { method: 'POST' }),

  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  masterRanges: () => request('/master-ranges'),
  createMasterRange: (data) =>
    request('/master-ranges', { method: 'POST', body: JSON.stringify(data) }),
  updateMasterRange: (id, data) =>
    request(`/master-ranges/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMasterRange: (id) => request(`/master-ranges/${id}`, { method: 'DELETE' }),

  datacenterVlans: () => request('/datacenter-vlans'),
  createDatacenterVlan: (data) =>
    request('/datacenter-vlans', { method: 'POST', body: JSON.stringify(data) }),
  updateDatacenterVlan: (id, data) =>
    request(`/datacenter-vlans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDatacenterVlan: (id) => request(`/datacenter-vlans/${id}`, { method: 'DELETE' }),

  azureSubnets: () => request('/azure-subnets'),
  createAzureSubnet: (data) =>
    request('/azure-subnets', { method: 'POST', body: JSON.stringify(data) }),
  updateAzureSubnet: (id, data) =>
    request(`/azure-subnets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAzureSubnet: (id) => request(`/azure-subnets/${id}`, { method: 'DELETE' }),

  cidrReference: () => request('/cidr-reference'),

  // CIDR utilities (advanced calc — split, merge, next-free, parse with IPAM overlap)
  // Bulk operations on IPs (admin)
  ipsBulk: (payload) =>
    request('/ips/bulk', { method: 'POST', body: JSON.stringify(payload) }),

  // Subnet utilization history
  subnetHistory: (id, days = 30) =>
    request(`/subnets/${id}/utilization-history?days=${days}`),
  snapshotSubnet: (id) =>
    request(`/subnets/${id}/utilization-snapshot`, { method: 'POST' }),

  cidrParse: (cidr) => request(`/cidr/parse?cidr=${encodeURIComponent(cidr)}`),
  cidrSplit: (cidr, prefix) =>
    request('/cidr/split', { method: 'POST', body: JSON.stringify({ cidr, prefix }) }),
  cidrMerge: (cidrs) =>
    request('/cidr/merge', { method: 'POST', body: JSON.stringify({ cidrs }) }),
  cidrNextFree: (parent, prefix, limit = 10) =>
    request(`/cidr/next-free?parent=${encodeURIComponent(parent)}&prefix=${prefix}&limit=${limit}`),

  // Cloud accounts (admin)
  cloudProviders: () => request('/cloud-providers'),
  cloudAccounts: () => request('/cloud-accounts'),
  cloudAccount: (id) => request(`/cloud-accounts/${id}`),
  createCloudAccount: (data) =>
    request('/cloud-accounts', { method: 'POST', body: JSON.stringify(data) }),
  updateCloudAccount: (id, data) =>
    request(`/cloud-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCloudAccount: (id) =>
    request(`/cloud-accounts/${id}`, { method: 'DELETE' }),
  testCloudAccount: (id) =>
    request(`/cloud-accounts/${id}/test`, { method: 'POST' }),
  syncCloudAccount: (id) =>
    request(`/cloud-accounts/${id}/sync`, { method: 'POST' }),
  cloudAccountRuns: (id, limit = 20) =>
    request(`/cloud-accounts/${id}/runs?limit=${limit}`),
  cloudAccountSubnets: (id) =>
    request(`/cloud-accounts/${id}/subnets`),

  // Cloud FinOps
  cloudIdlePublicIps: () => request('/cloud/finops/idle-public-ips'),
};
