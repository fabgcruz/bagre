// Reconciliação de papel em logins SSO/LDAP, com anti-lockout e diagnóstico (#129).
//
// Quando `adminGroups` está configurado, o IdP vira fonte da verdade do papel e
// sobrescreve o do usuário existente. Isso pode rebaixar (silenciosamente) o
// único admin se os grupos não casarem — o que trava o acesso administrativo.
// Aqui a decisão é isolada (pura, testável) e protegida contra esse lockout.
// O acesso ao banco fica em `resolveSsoRole` via import lazy, para que as
// funções puras possam ser testadas sem Prisma.

/**
 * Decide o papel efetivo de um usuário EXISTENTE num login SSO/LDAP.
 * PURA e testável — a contagem de admins ativos é injetada pela rota.
 *
 * @param {object} a
 * @param {string} a.currentRole         papel atual do usuário
 * @param {string} a.mappedRole          papel derivado dos grupos do IdP
 * @param {boolean} a.hasAdminGroups     se adminGroups está configurado
 * @param {boolean} a.isLastActiveAdmin  se este é o último admin ativo
 * @returns {{role: string, reason: 'no-admin-groups'|'anti-lockout'|'demoted'|'promoted'|'unchanged'}}
 */
export function decideRole({ currentRole, mappedRole, hasAdminGroups, isLastActiveAdmin }) {
  // Sem adminGroups: o IdP não gerencia papéis — mantém o atual (admin manual).
  if (!hasAdminGroups) return { role: currentRole, reason: 'no-admin-groups' };

  const demoting = currentRole === 'ADMIN' && mappedRole !== 'ADMIN';
  // Anti-lockout: nunca rebaixa o ÚLTIMO admin ativo via SSO/LDAP.
  if (demoting && isLastActiveAdmin) return { role: 'ADMIN', reason: 'anti-lockout' };

  if (mappedRole === currentRole) return { role: mappedRole, reason: 'unchanged' };
  return { role: mappedRole, reason: demoting ? 'demoted' : 'promoted' };
}

/** Mensagem de diagnóstico (grupos recebidos vs configurados). */
export function roleChangeNote({ provider, email, currentRole, decision, groups, adminGroups }) {
  const g = (groups || []).join(', ') || '—';
  const ag = (adminGroups || []).join(', ') || '—';
  if (decision.reason === 'anti-lockout') {
    return `[auth:${provider}] anti-lockout: mantido ADMIN de ${email} (era o último admin ativo). ` +
      `Grupos recebidos [${g}] não casaram com adminGroups [${ag}].`;
  }
  return `[auth:${provider}] papel de ${email}: ${currentRole} → ${decision.role}. ` +
    `Grupos recebidos [${g}] vs adminGroups [${ag}].`;
}

/**
 * Resolve o papel efetivo para um usuário existente, aplicando anti-lockout e
 * logando mudanças/mismatches. Retorna o papel a gravar.
 *
 * @param {object} a
 * @param {{role:string, email:string}} a.user
 * @param {string} a.mappedRole   papel derivado dos grupos
 * @param {{adminGroups?:string[]}} a.cfg
 * @param {string[]} a.groups      grupos recebidos do IdP
 * @param {'oidc'|'ldap'} a.provider
 * @param {{warn?:Function}} [a.log]
 */
export async function resolveSsoRole({ user, mappedRole, cfg, groups, provider, log }) {
  const hasAdminGroups = !!cfg.adminGroups?.length;

  // Só conta admins quando há de fato um rebaixamento em jogo (import lazy do
  // banco para manter as funções puras testáveis sem Prisma).
  let isLastActiveAdmin = false;
  if (hasAdminGroups && user.role === 'ADMIN' && mappedRole !== 'ADMIN') {
    const { prisma } = await import('../db.js');
    const n = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
    isLastActiveAdmin = n <= 1;
  }

  const decision = decideRole({
    currentRole: user.role,
    mappedRole,
    hasAdminGroups,
    isLastActiveAdmin,
  });

  if (decision.reason !== 'no-admin-groups' && decision.reason !== 'unchanged') {
    const note = roleChangeNote({
      provider,
      email: user.email,
      currentRole: user.role,
      decision,
      groups,
      adminGroups: cfg.adminGroups,
    });
    (log?.warn ? log.warn.bind(log) : console.warn)(note);
  }

  return decision.role;
}
