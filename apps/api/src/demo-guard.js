// Guardas do ambiente de demonstração (DEMO_MODE).
//
// Quando DEMO_MODE=true a instância é pública e compartilhada. A trava principal
// é o hook global onRequest em index.js: TODO POST/PUT/PATCH/DELETE em /api/* é
// 403, exceto /api/auth/login. Ou seja, o ambiente é 100% somente-leitura —
// inclusive aprovar/rejeitar pending discoveries (são POST → bloqueados).
// NÃO reabrir nenhum write aqui sem reavaliar o modelo de ameaça.
// Estes helpers são defesa em profundidade pra mascarar segredos/topologia.

export const DEMO = process.env.DEMO_MODE === 'true';

/** Resposta padrão para ações bloqueadas na demo. */
export function demoBlock(reply, msg) {
  reply.code(403);
  return {
    error: 'demo_mode_readonly',
    detail: msg || 'Ação desabilitada no ambiente de demonstração.',
  };
}

/** Remove campos "fixados" de um objeto de update quando em DEMO_MODE. */
export function stripDemoPinned(data, fields) {
  if (!DEMO) return data;
  for (const f of fields) delete data[f];
  return data;
}

/**
 * Em DEMO_MODE, oculta detalhes de CONEXÃO (host/URL/usuário/DN) das respostas
 * de config admin. Na demo o "admin" é um visitante anônimo da internet, então
 * topologia interna (ex.: `ldap://openldap:389`, `cn=admin,dc=corp,dc=local`)
 * não deve vazar. Não substitui o mascaramento de SEGREDOS (que vale sempre) —
 * é uma camada extra só pra demo. Fora da demo, retorna o objeto intacto.
 */
export function redactForDemo(obj, fields) {
  if (!DEMO || !obj) return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] != null && out[f] !== '') out[f] = '•••• (oculto na demo)';
  }
  return out;
}
