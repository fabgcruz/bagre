// Cliente HTTP fino para a API REST do Bagre.
//
// O servidor MCP é uma fachada: não reimplementa auth nem lógica de IPAM.
// Ele só carrega um token `bagre_…` e encaminha as chamadas. O escopo do token
// (READ_ONLY / READ_WRITE) é enforçado pela própria API — um token read-only
// recebe 403 em qualquer escrita, então o agente literalmente não consegue
// mutar o estado se você não quiser.

const RAW_BASE = process.env.BAGRE_API_URL || 'http://localhost:3001';
export const BASE_URL = RAW_BASE.replace(/\/+$/, ''); // sem barra final
const TOKEN = process.env.BAGRE_API_TOKEN || '';

if (!TOKEN) {
  // stdout é o canal do protocolo MCP — logs SEMPRE em stderr.
  console.error(
    '[bagre-mcp] AVISO: BAGRE_API_TOKEN não definido. As chamadas à API vão falhar com 401.\n' +
      '  Gere um token READ_ONLY em Admin → API Tokens e exporte BAGRE_API_TOKEN=bagre_…',
  );
}

// Idempotência: cache curto em memória por requisição (chave = URL do GET).
// Mata loops caros do agente — consultas de leitura idênticas repetidas na mesma
// sessão são atendidas do cache, e chamadas concorrentes idênticas compartilham
// UMA única requisição HTTP. TTL configurável (0 desliga). Só GET, só sucesso.
const CACHE_TTL_MS = Number(process.env.BAGRE_MCP_CACHE_TTL_MS ?? 5000);
const cache = new Map(); // urlString -> { at: epochMs, promise }

/** Erro com mensagem já traduzida para o agente entender o que fazer. */
export class BagreApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'BagreApiError';
    this.status = status;
  }
}

/** Traduz status HTTP em mensagens acionáveis para o agente. */
function explain(status, body) {
  // O corpo pode ser JSON (`{error}`) ou texto/HTML puro (5xx, proxy, gateway).
  // Nos dois casos extraímos um detalhe legível, truncado para não poluir o contexto.
  let detail = '';
  if (body && typeof body === 'object') {
    detail = body.error || body.message || body.detail || '';
  } else if (typeof body === 'string') {
    detail = body.trim();
  }
  if (typeof detail === 'string' && detail.length > 300) detail = detail.slice(0, 300) + '…';

  switch (status) {
    case 401:
      return 'Não autenticado: BAGRE_API_TOKEN ausente, inválido ou expirado.';
    case 403:
      // O caso mais comum num MCP read-only: tentativa de escrita bloqueada pelo escopo.
      return `Proibido: ${detail || 'este token não tem permissão para esta operação (provável escopo READ_ONLY).'}`;
    case 404:
      return `Não encontrado: ${detail || 'o recurso solicitado não existe.'}`;
    default:
      return detail
        ? `Erro HTTP ${status}: ${detail}`
        : `Erro HTTP ${status} ao chamar a API do Bagre.`;
  }
}

/** Executa o GET de fato e devolve o JSON parseado (ou lança BagreApiError). */
async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new BagreApiError(
      `Não foi possível conectar à API do Bagre em ${BASE_URL} (${err.message}). ` +
        'Verifique BAGRE_API_URL e se a API está no ar.',
      0,
    );
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text; // resposta não-JSON (ex.: HTML de erro)
  }

  if (!res.ok) {
    throw new BagreApiError(explain(res.status, body), res.status);
  }
  return body;
}

/**
 * GET em /path com querystring opcional. Retorna o JSON já parseado.
 * Idempotente por TTL: requisições idênticas dentro da janela reusam a resposta
 * (e chamadas concorrentes idênticas compartilham uma única requisição HTTP).
 * @param {string} path  ex.: '/api/search'
 * @param {Record<string, string|number|boolean|undefined>} [query]
 */
export async function apiGet(path, query) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  if (CACHE_TTL_MS <= 0) return fetchJson(url);

  const key = url.toString();
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return hit.promise; // em voo ou já resolvido — compartilha a mesma chamada
  }

  const promise = fetchJson(url);
  cache.set(key, { at: now, promise });
  // Nunca cacheia erro: se falhar, remove a entrada para não "grudar" a falha.
  promise.catch(() => {
    const cur = cache.get(key);
    if (cur && cur.promise === promise) cache.delete(key);
  });
  // Poda simples para não crescer sem limite em sessões longas.
  if (cache.size > 500) {
    for (const [k, v] of cache) if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
  }
  return promise;
}
