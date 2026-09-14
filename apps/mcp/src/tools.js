// Registro das tools do MCP. Cada tool é uma fachada 1:1 sobre um endpoint REST.
//
// Fase 0 (MVP): apenas `search`. As demais read tools entram na Fase 1 — o
// padrão abaixo (`readTool`) deixa cada adição em poucas linhas.

import { z } from 'zod';
import { apiGet, BagreApiError } from './client.js';

/** Envelopa um resultado JSON no formato de conteúdo do MCP. */
function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/** Envelopa um erro de forma que o agente veja a mensagem e possa se ajustar. */
function errorResult(err) {
  const msg =
    err instanceof BagreApiError ? err.message : `Erro inesperado: ${err.message}`;
  return { isError: true, content: [{ type: 'text', text: msg }] };
}

/**
 * Açúcar para registrar uma tool read-only que faz um GET.
 * @param server servidor MCP
 * @param {object} def
 * @param {string} def.name
 * @param {string} def.title
 * @param {string} def.description
 * @param {Record<string, import('zod').ZodTypeAny>} def.inputSchema  shape zod
 * @param {(args:any)=>{path:string, query?:object}} def.request  monta a chamada
 */
function readTool(server, def) {
  server.registerTool(
    def.name,
    {
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      try {
        const { path, query } = def.request(args || {});
        return jsonResult(await apiGet(path, query));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}

export function registerTools(server) {
  // --- Fase 0 ---------------------------------------------------------------
  readTool(server, {
    name: 'search',
    title: 'Buscar na rede',
    description:
      'Busca global no IPAM do Bagre por IPs, subnets, sites e devices. ' +
      'Aceita hostname, endereço IP, CIDR ou nome. Use para localizar recursos ' +
      'antes de detalhá-los.',
    inputSchema: {
      q: z.string().min(1).describe('Termo de busca: hostname, IP, CIDR ou nome'),
    },
    request: ({ q }) => ({ path: '/api/search', query: { q } }),
  });

  // --- Fase 1 (a adicionar): get_subnet, list_subnet_ips, subnet_next_free_ip,
  //     cidr_next_free, cidr_parse, list_sites_with_subnets, pending_discoveries,
  //     finops_idle_public_ips, stats, subnet_utilization_history --------------
}
