// Cliente JSON-RPC do Zabbix — camada de transporte/auth, SEM dependência de banco.
// Isolado do zabbix.js (orquestração/sync) para poder ser testado sem Prisma.
//
// Auth:
//  - apiToken (Zabbix 5.4+): preferido.
//  - username + password (mais antigo): user.login, sessão cacheada.
//
// Modo de envio do token, escolhido pela VERSÃO do Zabbix (detectada 1x e cacheada):
//  - >= 6.4 → header `Authorization: Bearer` (forma canônica; único modo aceito no
//             7.2+, que removeu o campo `auth` do corpo);
//  - <  6.4 → token no body `auth` (o header não existe nessas versões).

let sessionAuth = null;
let sessionConfigSig = null;
let authMode = null;
let authModeSig = null;

function configSig(cfg) {
  return [cfg.url, cfg.apiToken, cfg.username, cfg.password].join('|');
}

/** Pura: decide o modo de auth a partir da string de versão do Zabbix. */
export function pickAuthMode(version) {
  const m = String(version).match(/^(\d+)\.(\d+)/);
  if (!m) return 'header'; // versão não detectável → canônico (fallback do rpc cobre o resto)
  const major = Number(m[1]);
  const minor = Number(m[2]);
  // Header `Authorization: Bearer` só existe a partir do Zabbix 6.4.
  return major > 6 || (major === 6 && minor >= 4) ? 'header' : 'body';
}

/** Low-level JSON-RPC call. Adds auth automatically when needed. */
export async function rpc(cfg, method, params = {}, { needsAuth = true } = {}) {
  if (!cfg.url) throw new Error('Zabbix URL não configurada');
  const endpoint = cfg.url.replace(/\/$/, '') + '/api_jsonrpc.php';

  let auth = null;
  if (needsAuth) {
    if (cfg.apiToken) {
      auth = cfg.apiToken;
    } else {
      auth = await ensureSession(cfg);
    }
  }

  async function call(useHeaderAuth, useBodyAuth) {
    const headers = { 'Content-Type': 'application/json-rpc' };
    if (auth && useHeaderAuth) headers.Authorization = `Bearer ${auth}`;
    const body = {
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    };
    if (auth && useBodyAuth) body.auth = auth;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Zabbix HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) {
      throw new Error(`Zabbix RPC: ${json.error.message} ${json.error.data || ''}`.trim());
    }
    return json.result;
  }

  if (!auth) return call(false, false);

  // Escolhe o modo pela versão do Zabbix. Cada chamada faz UMA requisição,
  // sem depender do texto do erro.
  const mode = await ensureAuthMode(cfg);

  if (mode === 'body') {
    return call(false, true);
  }

  // Modo header. Fallback para o body SOMENTE quando um proxy/nginx remove o header
  // Authorization em instalações >= 6.4 (known-issue do Zabbix): a resposta vem como
  // "Not authorized". No 7.2+ o body é rejeitado, então re-lançamos o erro do header.
  try {
    return await call(true, false);
  } catch (headerErr) {
    if (/not authorized|unauthorized/i.test(headerErr.message)) {
      try {
        return await call(false, true);
      } catch {
        throw headerErr;
      }
    }
    throw headerErr;
  }
}

/**
 * Descobre uma única vez qual modo de auth usar (via `apiinfo.version`, que não
 * exige auth). Cacheado por config; revalida quando a config muda.
 */
async function ensureAuthMode(cfg) {
  const sig = configSig(cfg);
  if (authMode && authModeSig === sig) return authMode;
  let mode = 'header';
  try {
    const version = await rpc(cfg, 'apiinfo.version', {}, { needsAuth: false });
    mode = pickAuthMode(version);
  } catch {
    // Sem versão detectável: mantém 'header' e deixa o fallback do rpc() agir.
  }
  authMode = mode;
  authModeSig = sig;
  return mode;
}

async function ensureSession(cfg) {
  const sig = configSig(cfg);
  if (sessionAuth && sessionConfigSig === sig) return sessionAuth;
  if (!cfg.username || !cfg.password) {
    throw new Error('Sem token e sem usuário/senha — configure ao menos um');
  }
  const auth = await rpc(
    cfg,
    'user.login',
    { username: cfg.username, password: cfg.password },
    { needsAuth: false },
  );
  sessionAuth = auth;
  sessionConfigSig = sig;
  return auth;
}

export function invalidateSession() {
  sessionAuth = null;
  sessionConfigSig = null;
  authMode = null;
  authModeSig = null;
}
