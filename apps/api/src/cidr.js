// Pure helpers for CIDR math — IPv4 e IPv6.
//
// IPv4: usa Number 32-bit (rápido, simples).
// IPv6: usa BigInt 128-bit (parse hex → BigInt). Enumeração de subnets v6
// é INTENCIONALMENTE não suportada — um /64 tem 18.446.744.073.709.551.616
// endereços, impossível listar. IPs IPv6 são adicionados manualmente
// (POST /api/subnets/:id/ips) ou via discovery (Zabbix/cloud-sync).

const IPV4_CIDR_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const IPV6_CIDR_RE = /^([0-9a-fA-F:]+)\/(\d{1,3})$/;

// ---- IPv4 helpers ----

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function parseIpv4Cidr(cidr) {
  const m = cidr && cidr.match(IPV4_CIDR_RE);
  if (!m) return null;
  const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  const prefix = Number(m[5]);
  if (prefix < 0 || prefix > 32) return null;
  for (const o of [m[1], m[2], m[3], m[4]]) {
    if (Number(o) > 255) return null;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  // `&` em JS opera em int32 signed — sem o `>>> 0` final, qualquer network
  // com o bit alto setado (≥ 128.0.0.0) volta como negativo. Esse era o
  // bug #29 (192.168.x.x quebrava enquanto 10.x.x.x funcionava).
  const network = (ipToInt(ip) & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { version: 4, network, broadcast, prefix, mask };
}

// Backward-compat alias: muitas chamadas existentes usam parseCidr esperando v4.
export const parseCidr = parseIpv4Cidr;

// ---- IPv6 helpers (BigInt) ----

/** Expande "::1" → 8 grupos hex; retorna BigInt. */
function ipv6ToBigInt(addr) {
  if (!addr || typeof addr !== 'string') return null;
  // Lida com :: (compressão)
  let head = addr;
  let tail = '';
  if (addr.includes('::')) {
    const parts = addr.split('::');
    if (parts.length !== 2) return null;
    head = parts[0];
    tail = parts[1];
  } else if (addr.startsWith(':') || addr.endsWith(':')) {
    return null;
  }
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const totalNonZero = headGroups.length + tailGroups.length;
  if (totalNonZero > 8) return null;
  const zerosCount = addr.includes('::') ? 8 - totalNonZero : 0;
  if (!addr.includes('::') && totalNonZero !== 8) return null;
  const groups = [
    ...headGroups,
    ...Array(zerosCount).fill('0'),
    ...tailGroups,
  ];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** Formato canônico (compactado) de um BigInt como IPv6. */
function bigIntToIpv6(n) {
  const groups = [];
  let v = n;
  for (let i = 0; i < 8; i++) {
    groups.unshift((v & 0xffffn).toString(16));
    v = v >> 16n;
  }
  // Compactação :: na maior sequência de zeros
  let bestStart = -1, bestLen = 0;
  let curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === '0') {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else {
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen < 2) return groups.join(':');
  const before = groups.slice(0, bestStart).join(':');
  const after = groups.slice(bestStart + bestLen).join(':');
  return `${before}::${after}`;
}

export function parseIpv6Cidr(cidr) {
  const m = cidr && cidr.match(IPV6_CIDR_RE);
  if (!m) return null;
  const prefix = Number(m[2]);
  if (prefix < 0 || prefix > 128) return null;
  const ipInt = ipv6ToBigInt(m[1]);
  if (ipInt === null) return null;
  const fullMask = (1n << 128n) - 1n;
  const mask = prefix === 0 ? 0n : (fullMask << BigInt(128 - prefix)) & fullMask;
  const network = ipInt & mask;
  const lastAddr = network | (~mask & fullMask);
  return {
    version: 6,
    network,
    networkStr: bigIntToIpv6(network),
    lastAddr,
    lastAddrStr: bigIntToIpv6(lastAddr),
    prefix,
  };
}

/** Detecta versão sem parser completo. */
export function detectIpVersion(cidr) {
  if (!cidr || typeof cidr !== 'string') return null;
  if (cidr.includes(':')) return 6;
  if (cidr.includes('.')) return 4;
  return null;
}

/**
 * Retorna todos os IPs em um CIDR.
 *
 * - IPv4: enumera (cap 4096).
 * - IPv6: retorna [] vazio. Subnets v6 não pré-criam IPs — operador
 *   adiciona endereços específicos via POST /api/subnets/:id/ips.
 */
export function expandCidr(cidr, { includeNetwork = false, includeBroadcast = false } = {}) {
  const version = detectIpVersion(cidr);
  if (version === 6) {
    // Subnets v6 não pré-enumeram. Allocate-on-demand.
    return [];
  }
  const parsed = parseIpv4Cidr(cidr);
  if (!parsed) return [];
  const { network, broadcast, prefix } = parsed;
  const total = broadcast - network + 1;
  if (total > 4096) {
    throw new Error(
      `O bloco ${cidr} tem ${total.toLocaleString('pt-BR')} IPs, acima do limite de 4.096 por sub-rede ` +
        `(equivale a /20 ou menor). O Bagre rastreia cada IP individualmente, então blocos grandes como /16 ` +
        `devem ser cadastrados como Range Mestre (Catálogos → Ranges Mestre) — e as sub-redes de trabalho ` +
        `(ex.: /24) criadas dentro dele, onde os IPs são gerenciados.`,
    );
  }
  let start = network;
  let end = broadcast;
  if (prefix < 31) {
    if (!includeNetwork) start = network + 1;
    if (!includeBroadcast) end = broadcast - 1;
  }
  const out = [];
  for (let n = start; n <= end; n++) out.push(intToIp(n));
  return out;
}

/** Normaliza um endereço IPv6 pra forma canônica compactada (ou retorna como veio se IPv4). */
export function normalizeAddress(addr) {
  if (!addr) return addr;
  if (addr.includes(':')) {
    const n = ipv6ToBigInt(addr);
    if (n === null) return addr;
    return bigIntToIpv6(n);
  }
  return addr;
}
