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
      q: z.string().min(2).describe('Termo de busca (mín. 2 caracteres): hostname, IP, CIDR ou nome'),
    },
    request: ({ q }) => ({ path: '/api/search', query: { q } }),
  });

  // --- Fase 1: read tools -----------------------------------------------------

  readTool(server, {
    name: 'list_sites_with_subnets',
    title: 'Listar sites e subnets',
    description:
      'Lista todos os sites (datacenters/localidades) com suas subnets. ' +
      'Use para ter o mapa geral da rede e descobrir IDs de subnet.',
    inputSchema: {},
    request: () => ({ path: '/api/sites' }),
  });

  readTool(server, {
    name: 'get_subnet',
    title: 'Detalhar subnet',
    description:
      'Retorna uma subnet pelo ID, incluindo contagem de IPs usados/livres. ' +
      'Descubra o ID via search ou list_sites_with_subnets.',
    inputSchema: {
      id: z.coerce.number().int().positive().describe('ID numérico da subnet'),
    },
    request: ({ id }) => ({ path: `/api/subnets/${id}` }),
  });

  readTool(server, {
    name: 'list_subnet_ips',
    title: 'Listar IPs de uma subnet',
    description:
      'Lista os endereços de uma subnet, com filtro opcional por status e busca livre ' +
      '(hostname, IP, tipo ou função).',
    inputSchema: {
      id: z.coerce.number().int().positive().describe('ID numérico da subnet'),
      status: z
        .enum(['FREE', 'USED', 'RESERVED', 'CONFLICT'])
        .optional()
        .describe('Filtra por status do IP'),
      q: z.string().optional().describe('Busca livre: hostname, IP, tipo ou função'),
    },
    request: ({ id, status, q }) => ({ path: `/api/subnets/${id}/ips`, query: { status, q } }),
  });

  readTool(server, {
    name: 'subnet_next_free_ip',
    title: 'Próximo IP livre da subnet',
    description:
      'Retorna o próximo endereço FREE de uma subnet (o menor livre). ' +
      'Retorna erro se a subnet estiver esgotada ou for IPv6 (que não pré-enumera).',
    inputSchema: {
      id: z.coerce.number().int().positive().describe('ID numérico da subnet'),
    },
    request: ({ id }) => ({ path: `/api/subnets/${id}/next-free-ip` }),
  });

  readTool(server, {
    name: 'subnet_utilization_history',
    title: 'Histórico de utilização da subnet',
    description:
      'Série temporal de ocupação (total/usados/reservados/livres) de uma subnet, ' +
      'para avaliar tendência de esgotamento.',
    inputSchema: {
      id: z.coerce.number().int().positive().describe('ID numérico da subnet'),
      days: z
        .coerce.number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe('Janela em dias (1-365, padrão 30)'),
    },
    request: ({ id, days }) => ({
      path: `/api/subnets/${id}/utilization-history`,
      query: { days },
    }),
  });

  readTool(server, {
    name: 'cidr_parse',
    title: 'Analisar um CIDR',
    description:
      'Analisa um bloco CIDR (IPv4 ou IPv6): rede, broadcast, total de endereços, ' +
      'e cruzamento com subnets/master ranges existentes (overlaps).',
    inputSchema: {
      cidr: z.string().min(1).describe('Bloco CIDR, ex.: 10.20.0.0/24'),
    },
    request: ({ cidr }) => ({ path: '/api/cidr/parse', query: { cidr } }),
  });

  readTool(server, {
    name: 'cidr_next_free',
    title: 'Próximos blocos CIDR livres',
    description:
      'Dentro de um CIDR pai, encontra os próximos sub-blocos livres de um prefixo alvo ' +
      '(que não colidem com subnets existentes). Útil para planejar novas subnets.',
    inputSchema: {
      parent: z.string().min(1).describe('CIDR pai, ex.: 10.20.0.0/16'),
      prefix: z.coerce.number().int().min(0).max(32).describe('Prefixo alvo dos blocos, ex.: 24'),
      limit: z.coerce.number().int().min(1).max(256).optional().describe('Máx. de blocos (padrão 10)'),
    },
    request: ({ parent, prefix, limit }) => ({
      path: '/api/cidr/next-free',
      query: { parent, prefix, limit },
    }),
  });

  readTool(server, {
    name: 'pending_discoveries',
    title: 'Descobertas pendentes de aprovação',
    description:
      'Lista descobertas de rede aguardando decisão (ex.: hosts vistos por Zabbix/scanner), ' +
      'com filtros opcionais por status, fonte, subnet sugerida e busca livre.',
    inputSchema: {
      status: z.string().optional().describe('Filtra por status da descoberta'),
      source: z.string().optional().describe('Filtra pela fonte (ex.: zabbix)'),
      suggestedSubnet: z.string().optional().describe('CIDR da subnet sugerida'),
      q: z.string().optional().describe('Busca livre: IP, hostname ou fabricante'),
    },
    request: ({ status, source, suggestedSubnet, q }) => ({
      path: '/api/pending-discoveries',
      query: { status, source, suggestedSubnet, q },
    }),
  });

  readTool(server, {
    name: 'pending_discoveries_stats',
    title: 'Estatísticas de descobertas pendentes',
    description: 'Contagens agregadas de descobertas por status e por subnet sugerida.',
    inputSchema: {},
    request: () => ({ path: '/api/pending-discoveries/stats' }),
  });

  readTool(server, {
    name: 'finops_idle_public_ips',
    title: 'IPs públicos ociosos (FinOps)',
    description:
      'Lista IPs públicos de nuvem (AWS/Azure/GCP) ociosos, com estimativa de custo — ' +
      'candidatos a liberação para economia. Apenas leitura: propõe, não libera.',
    inputSchema: {},
    request: () => ({ path: '/api/cloud/finops/idle-public-ips' }),
  });

  readTool(server, {
    name: 'stats',
    title: 'Estatísticas gerais',
    description: 'Resumo geral do IPAM: totais de sites, subnets e IPs por status.',
    inputSchema: {},
    request: () => ({ path: '/api/stats' }),
  });
}
