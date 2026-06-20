// Guard anti-SSRF para URLs de integração configuradas por um admin
// (Zabbix/Prometheus/PowerDNS etc.). O alvo é o vetor clássico de roubo de
// credenciais em nuvem: apontar a integração para o endpoint de metadata
// link-local (169.254.169.254 / fd00:ec2::254) e fazer o servidor buscá-lo.
//
// IMPORTANTE: faixas PRIVADAS (10/8, 172.16/12, 192.168/16) e loopback são
// PERMITIDAS por padrão — integrações internas (Zabbix/Prometheus na rede
// interna, em hostnames como `zabbix-web`) são o caso de uso NORMAL e não
// podemos quebrá-las. Bloqueamos só link-local/metadata.
// Para travar tudo (também privado/loopback), set INTEGRATION_URL_STRICT=true.

import dns from 'node:dns/promises';
import net from 'node:net';

function classifyIp(ip, strict) {
  const v = ip.replace(/^::ffff:/i, ''); // IPv4-mapped IPv6
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    if (a === 169 && b === 254) return 'link-local/metadata'; // 169.254.0.0/16
    if (strict) {
      if (a === 127) return 'loopback';
      if (a === 0) return 'reservado';
      if (a === 10) return 'rede privada';
      if (a === 172 && b >= 16 && b <= 31) return 'rede privada';
      if (a === 192 && b === 168) return 'rede privada';
    }
    return null;
  }
  const low = v.toLowerCase();
  if (low.startsWith('fe80')) return 'link-local'; // fe80::/10
  if (low === 'fd00:ec2::254') return 'metadata'; // AWS IMDS IPv6
  if (strict && (low === '::1' || low.startsWith('fc') || low.startsWith('fd'))) {
    return 'loopback/privado';
  }
  return null;
}

/**
 * Lança Error se a URL apontar para um destino bloqueado. Resolve o hostname
 * (pega todos os IPs) — pega tanto IP literal quanto nome que resolve pra
 * metadata. Use ao SALVAR a config de integração.
 */
export async function assertSafeIntegrationUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Apenas http/https são permitidos');
  }
  const strict = process.env.INTEGRATION_URL_STRICT === 'true';
  const host = u.hostname.replace(/^\[|\]$/g, ''); // remove colchetes de IPv6

  let ips;
  if (net.isIP(host)) {
    ips = [host];
  } else {
    try {
      ips = (await dns.lookup(host, { all: true })).map((r) => r.address);
    } catch {
      throw new Error(`não foi possível resolver o host: ${host}`);
    }
  }
  for (const ip of ips) {
    const why = classifyIp(ip, strict);
    if (why) throw new Error(`destino bloqueado (${why}): ${host} → ${ip}`);
  }
}
