// Provider de autenticação LDAP / Active Directory on-premises (bind direto).
//
// SEGURANÇA (priorizar sempre):
//  - Valida a senha fazendo BIND COMO O USUÁRIO (não comparando hash) — é o jeito
//    correto pra LDAP/AD.
//  - REJEITA senha vazia: muitos servidores tratam "bind com senha vazia" como
//    bind anônimo bem-sucedido → seria auth bypass. Nunca permitir.
//  - ESCAPA o username no filtro de busca (RFC 4515) → anti LDAP-injection.
//  - Usa TLS pro bind da senha (ldaps:// ou StartTLS); cert validado por padrão.
//  - Conexão sempre encerrada (unbind no finally).
//
// O login local e o SSO/OIDC continuam em paralelo (anti-lockout).

import { Client } from 'ldapts';
import { prisma } from '../db.js';

export async function getConfig() {
  let cfg = await prisma.ldapConfig.findUnique({ where: { id: 1 } });
  if (!cfg) cfg = await prisma.ldapConfig.create({ data: { id: 1 } });
  return cfg;
}

export function isConfigured(cfg) {
  return Boolean(cfg?.url && cfg?.baseDn && cfg?.userFilter);
}

// Escapa caracteres especiais de filtro LDAP (RFC 4515) — anti-injection.
function escapeFilter(value) {
  return String(value).replace(
    /[\\*()\0]/g,
    (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'),
  );
}

// Opções de TLS — usadas tanto em ldaps:// (no construtor) quanto no StartTLS.
//  - rejectUnauthorized: valida o cert do servidor. ON por padrão (boa prática).
//    Só vira false se o admin explicitamente desligar (lab/ins=eguro).
//  - ca: confia numa CA específica (a CA interna do AD/AD CS) sem desligar a
//    validação — é o caminho SEGURO pra LDAPS on-premise com cert de CA própria.
//    O Node também aceita NODE_EXTRA_CA_CERTS como alternativa via env.
function buildTlsOptions(cfg) {
  const opts = { rejectUnauthorized: cfg.tlsRejectUnauthorized !== false };
  if (cfg.caCert && String(cfg.caCert).trim()) {
    opts.ca = [String(cfg.caCert)];
  }
  return opts;
}

function makeClient(cfg) {
  const opts = { url: cfg.url, timeout: 8000, connectTimeout: 8000 };
  // tlsOptions SÓ pra ldaps:// — passar em ldap:// faz o ldapts tentar um
  // handshake TLS que o servidor recusa ("socket disconnected before TLS").
  // No StartTLS o TLS é negociado no client.startTLS() (ver withClient).
  if ((cfg.url || '').startsWith('ldaps://')) {
    opts.tlsOptions = buildTlsOptions(cfg);
  }
  return new Client(opts);
}

async function withClient(cfg, fn) {
  const client = makeClient(cfg);
  try {
    if (cfg.startTls) await client.startTLS(buildTlsOptions(cfg));
    return await fn(client);
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}

function pickAttr(entry, attr) {
  const v = entry?.[attr];
  return Array.isArray(v) ? v[0] : v;
}

function toArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

/** Mapeia os grupos do AD para ADMIN/READER. */
export function mapRole(cfg, groups) {
  const admin = (cfg.adminGroups || []).map((g) => String(g).toLowerCase().trim()).filter(Boolean);
  if (admin.length) {
    const set = new Set(groups.map((g) => String(g).toLowerCase()));
    if (admin.some((g) => set.has(g))) return 'ADMIN';
  }
  return cfg.defaultRole || 'READER';
}

/** Teste de conexão — usado pelo botão "Testar conexão" do admin. */
export async function testConnection(cfg) {
  if (!cfg?.url) return { ok: false, message: 'URL do LDAP ausente' };
  try {
    await withClient(cfg, async (client) => {
      if (cfg.bindDn) await client.bind(cfg.bindDn, cfg.bindPassword || '');
      if (cfg.baseDn) {
        await client.search(cfg.baseDn, {
          scope: 'base',
          filter: '(objectClass=*)',
          sizeLimit: 1,
        });
      }
    });
    return { ok: true, message: `OK — conectou em ${cfg.url}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Autentica username+password contra o AD/LDAP.
 * @returns {Promise<null | {email, name, dn, groups, role}>} null se inválido.
 */
export async function authenticate(cfg, username, password) {
  if (!cfg?.enabled || !isConfigured(cfg)) return null;
  // Anti-bypass: senha/username vazios são rejeitados sempre.
  if (!username || !password) return null;

  const filter = cfg.userFilter.replace(/\{username\}/g, escapeFilter(username));

  return withClient(cfg, async (client) => {
    // 1) Bind de serviço pra buscar o usuário (ou anônimo, se sem bindDn).
    if (cfg.bindDn) {
      await client.bind(cfg.bindDn, cfg.bindPassword || '');
    }
    // 2) Busca o usuário pelo filtro.
    const { searchEntries } = await client.search(cfg.baseDn, {
      scope: 'sub',
      filter,
      attributes: [cfg.emailAttr, cfg.nameAttr, cfg.groupAttr],
      sizeLimit: 2,
    });
    if (searchEntries.length !== 1) return null; // 0 = não existe; >1 = ambíguo
    const entry = searchEntries[0];
    const userDn = entry.dn;
    if (!userDn) return null;

    // 3) Re-bind COMO o usuário com a senha → valida a credencial.
    try {
      await client.bind(userDn, password);
    } catch {
      return null; // senha incorreta
    }

    // 4) Extrai claims e mapeia papel.
    const email = pickAttr(entry, cfg.emailAttr) || username;
    const name = pickAttr(entry, cfg.nameAttr) || username;
    const groups = toArray(entry[cfg.groupAttr]);
    return {
      email: String(email).toLowerCase(),
      name: String(name),
      dn: userDn,
      groups,
      role: mapRole(cfg, groups),
    };
  });
}
