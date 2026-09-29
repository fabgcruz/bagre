// Testes da decisão de papel SSO/LDAP (#129) — anti-lockout do último admin.
// Rodam com `node --test`, sem deps nem banco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRole, roleChangeNote } from './role-sync.js';

test('sem adminGroups: mantém o papel atual (IdP não gerencia)', () => {
  const d = decideRole({ currentRole: 'ADMIN', mappedRole: 'READER', hasAdminGroups: false, isLastActiveAdmin: true });
  assert.deepEqual(d, { role: 'ADMIN', reason: 'no-admin-groups' });
});

test('promove READER → ADMIN quando o grupo casa', () => {
  const d = decideRole({ currentRole: 'READER', mappedRole: 'ADMIN', hasAdminGroups: true, isLastActiveAdmin: false });
  assert.deepEqual(d, { role: 'ADMIN', reason: 'promoted' });
});

test('rebaixa admin comum (NÃO é o último) → READER', () => {
  const d = decideRole({ currentRole: 'ADMIN', mappedRole: 'READER', hasAdminGroups: true, isLastActiveAdmin: false });
  assert.deepEqual(d, { role: 'READER', reason: 'demoted' });
});

test('ANTI-LOCKOUT: não rebaixa o ÚLTIMO admin ativo — mantém ADMIN', () => {
  const d = decideRole({ currentRole: 'ADMIN', mappedRole: 'READER', hasAdminGroups: true, isLastActiveAdmin: true });
  assert.deepEqual(d, { role: 'ADMIN', reason: 'anti-lockout' });
});

test('sem mudança: READER continua READER', () => {
  const d = decideRole({ currentRole: 'READER', mappedRole: 'READER', hasAdminGroups: true, isLastActiveAdmin: false });
  assert.deepEqual(d, { role: 'READER', reason: 'unchanged' });
});

test('admin que segue admin: unchanged (isLastActiveAdmin irrelevante)', () => {
  const d = decideRole({ currentRole: 'ADMIN', mappedRole: 'ADMIN', hasAdminGroups: true, isLastActiveAdmin: true });
  assert.deepEqual(d, { role: 'ADMIN', reason: 'unchanged' });
});

test('roleChangeNote: anti-lockout mostra grupos recebidos vs adminGroups', () => {
  const note = roleChangeNote({
    provider: 'oidc',
    email: 'admin@x',
    currentRole: 'ADMIN',
    decision: { role: 'ADMIN', reason: 'anti-lockout' },
    groups: ['users'],
    adminGroups: ['Admins'],
  });
  assert.match(note, /anti-lockout/);
  assert.match(note, /users/);
  assert.match(note, /Admins/);
});
