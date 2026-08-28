// TopDesk (ITSM) provider — push dos IPs/hosts do Bagre como Ativos (CIs) no
// Asset Management do TopDesk.
//
// API ref: https://developers.topdesk.com/explorer/?page=assets
//   GET   /tas/api/assetmgmt/templates                           lista templates
//   GET   /tas/api/assetmgmt/assets?templateId=..&fields=..      consulta ativos
//   POST  /tas/api/assetmgmt/assets/templateId/{templateId}      cria ativo
//   PATCH /tas/api/assetmgmt/assets/templateId/{templateId}/{id} atualiza ativo
//
// Auth via Basic (usuário + application password). O application password é
// gerado no TopDesk por operador e revogável, sem expor o login real.
//
// Estratégia de sync (espelha o provider de DNS):
//   - Lê os IPs do Bagre com status=USED
//   - Lê os ativos do template dedicado (o "conjunto gerenciado" pelo Bagre)
//   - Casa pelo valor do campo de IP e monta o diff { toCreate, toUpdate }
//   - Aplica via POST (novos) / PATCH (hostname mudou)
//
// v1 NÃO deleta ativos: liberar um IP no Bagre não apaga o CI no TopDesk
// (remover CI é destrutivo e normalmente passa por processo próprio no ITSM).
// O template dedicado garante que só tocamos em ativos criados pelo Bagre —
// CIs de outros templates ficam intactos.

import { prisma } from '../../db.js';

export const name = 'topdesk';

const API_PREFIX = '/tas/api/assetmgmt';

function buildHeaders(cfg) {
  const auth = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function apiUrl(cfg, path) {
  return `${cfg.baseUrl.replace(/\/$/, '')}${API_PREFIX}${path}`;
}

async function tdRequest(cfg, method, path, body) {
  const res = await fetch(apiUrl(cfg, path), {
    method,
    headers: buildHeaders(cfg),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`TopDesk ${method} ${res.status} ${path}: ${t.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// A API de assets ora devolve um array cru, ora encapsula em { dataSet } /
// { results }. Normaliza pra sempre trabalhar com array.
function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.dataSet)) return payload.dataSet;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

// Campos do ativo podem vir no topo do objeto ou aninhados em `data`.
function readField(asset, fieldId) {
  if (!fieldId) return undefined;
  if (asset[fieldId] !== undefined) return asset[fieldId];
  if (asset.data && asset.data[fieldId] !== undefined) return asset.data[fieldId];
  return undefined;
}

/** Config singleton (id=1), criada sob demanda. */
export async function getConfig() {
  let cfg = await prisma.topDeskConfig.findUnique({ where: { id: 1 } });
  if (!cfg) cfg = await prisma.topDeskConfig.create({ data: { id: 1 } });
  return cfg;
}

export function isConfigured(cfg) {
  return Boolean(
    cfg?.baseUrl && cfg?.username && cfg?.password && cfg?.assetTemplateId && cfg?.ipFieldId,
  );
}

/** Lista os templates de ativo — usado pela UI pra o admin escolher o dedicado. */
export async function listTemplates(cfg) {
  const payload = await tdRequest(cfg, 'GET', '/templates');
  return asList(payload).map((t) => ({
    id: t.id ?? t.unid ?? t.templateId,
    name: t.name ?? t.text ?? t.description ?? t.id,
  }));
}

/**
 * Health check leve: valida credenciais e o template escolhido.
 * Não escreve nada — só GETs.
 */
export async function testConnection(cfg) {
  if (!cfg?.baseUrl || !cfg?.username || !cfg?.password) {
    return { ok: false, message: 'baseUrl, usuário e senha são obrigatórios' };
  }
  try {
    const templates = await listTemplates(cfg);
    let msg = `Conexão OK · ${templates.length} templates`;
    if (cfg.assetTemplateId) {
      const found = templates.find((t) => String(t.id) === String(cfg.assetTemplateId));
      if (found) {
        msg += ` · template "${found.name}" OK`;
      } else {
        return {
          ok: false,
          message: `Conexão OK, mas o template ${cfg.assetTemplateId} não foi encontrado`,
        };
      }
    }
    return { ok: true, message: msg };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Lê os ativos gerenciados (do template dedicado) e devolve um mapa
 * `ip -> { assetId, hostname }`. É o estado atual no TopDesk.
 */
async function readManagedAssets(cfg) {
  const fields = ['id', 'name', cfg.ipFieldId, cfg.hostnameFieldId]
    .filter(Boolean)
    .join(',');
  const qs = new URLSearchParams({
    templateId: cfg.assetTemplateId,
    fields,
    pageSize: '5000',
  }).toString();
  const payload = await tdRequest(cfg, 'GET', `/assets?${qs}`);
  const byIp = new Map();
  for (const a of asList(payload)) {
    const ip = readField(a, cfg.ipFieldId);
    if (!ip) continue;
    byIp.set(String(ip).trim(), {
      assetId: a.id ?? a.unid,
      hostname: cfg.hostnameFieldId ? readField(a, cfg.hostnameFieldId) ?? null : null,
      name: a.name ?? null,
    });
  }
  return byIp;
}

/** Estado desejado a partir do Bagre: `ip -> { hostname }` (IPs USED). */
async function readBagreIps(prismaClient) {
  const ips = await prismaClient.ipAddress.findMany({
    where: { status: 'USED' },
    select: { address: true, hostname: true },
  });
  const byIp = new Map();
  for (const it of ips) {
    if (!it.address) continue;
    byIp.set(String(it.address).trim(), {
      hostname: it.hostname && it.hostname.trim() ? it.hostname.trim() : null,
    });
  }
  return byIp;
}

function diff(bagre, managed) {
  const toCreate = []; // [{ ip, hostname }]
  const toUpdate = []; // [{ ip, assetId, hostname, currentHostname }]
  for (const [ip, want] of bagre.entries()) {
    const have = managed.get(ip);
    if (!have) {
      toCreate.push({ ip, hostname: want.hostname });
    } else if ((want.hostname || null) !== (have.hostname || null)) {
      toUpdate.push({
        ip,
        assetId: have.assetId,
        hostname: want.hostname,
        currentHostname: have.hostname || null,
      });
    }
  }
  return { toCreate, toUpdate };
}

/** Monta o body de campos do ativo a partir do IP/hostname. */
function assetBody(cfg, ip, hostname) {
  const body = { [cfg.ipFieldId]: ip };
  // `name` é o rótulo do ativo no TopDesk — usa o hostname, caindo pro IP.
  body.name = hostname || ip;
  if (cfg.hostnameFieldId && hostname) body[cfg.hostnameFieldId] = hostname;
  return body;
}

/** Calcula e retorna o preview do diff (sem aplicar). */
export async function previewSync(prismaClient, cfg) {
  const [bagre, managed] = await Promise.all([
    readBagreIps(prismaClient),
    readManagedAssets(cfg),
  ]);
  const { toCreate, toUpdate } = diff(bagre, managed);
  return { templateId: cfg.assetTemplateId, managedCount: managed.size, toCreate, toUpdate };
}

/** Aplica o diff: cria novos ativos e atualiza os que mudaram de hostname. */
export async function applySync(prismaClient, cfg) {
  const preview = await previewSync(prismaClient, cfg);
  let created = 0;
  let updated = 0;
  const errors = [];

  for (const c of preview.toCreate) {
    try {
      await tdRequest(
        cfg,
        'POST',
        `/assets/templateId/${encodeURIComponent(cfg.assetTemplateId)}`,
        assetBody(cfg, c.ip, c.hostname),
      );
      created += 1;
    } catch (err) {
      errors.push(`create ${c.ip}: ${err.message}`);
    }
  }

  for (const u of preview.toUpdate) {
    try {
      await tdRequest(
        cfg,
        'PATCH',
        `/assets/templateId/${encodeURIComponent(cfg.assetTemplateId)}/${encodeURIComponent(u.assetId)}`,
        assetBody(cfg, u.ip, u.hostname),
      );
      updated += 1;
    } catch (err) {
      errors.push(`update ${u.ip}: ${err.message}`);
    }
  }

  return {
    ok: errors.length === 0,
    created,
    updated,
    skipped: 0,
    errors,
    toCreate: preview.toCreate,
    toUpdate: preview.toUpdate,
  };
}
