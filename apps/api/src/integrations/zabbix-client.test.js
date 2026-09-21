// Testes do cliente Zabbix (auth por versão) — rodam com `node --test`, sem
// dependências nem Zabbix real. Mocka `globalThis.fetch` e simula cada versão.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rpc, pickAuthMode, invalidateSession } from './zabbix-client.js';

// Cenários por URL: qual versão e quais modos de auth aquele Zabbix aceita.
const SCENARIOS = {
  'http://zbx-7.4': { version: '7.4.6', header: true, body: false }, // 7.2+ removeu o body
  'http://zbx-7.0': { version: '7.0.19', header: true, body: true }, // aceita ambos
  'http://zbx-6.0': { version: '6.0.44', header: false, body: true }, // header não existe
  'http://zbx-6.4-proxy': { version: '6.4.0', header: false, body: true }, // proxy remove o header
};

let calls = [];
function installFetchMock() {
  globalThis.fetch = async (url, opts) => {
    const host = Object.keys(SCENARIOS).find((h) => url.startsWith(h));
    const sc = SCENARIOS[host];
    const body = JSON.parse(opts.body);
    const hasHeaderAuth = !!(opts.headers && opts.headers.Authorization);
    const hasBodyAuth = body.auth !== undefined;
    calls.push({ host, method: body.method, hasHeaderAuth, hasBodyAuth });
    const ok = (json) => ({ ok: true, json: async () => json });
    if (body.method === 'apiinfo.version') return ok({ result: sc.version });
    const headerWorks = hasHeaderAuth && sc.header;
    const bodyWorks = hasBodyAuth && sc.body;
    if (headerWorks || bodyWorks) return ok({ result: [] });
    if (hasBodyAuth && !sc.body) {
      return ok({ error: { message: 'Invalid params.', data: 'Unexpected parameter "auth".' } });
    }
    return ok({ error: { message: 'Not authorized.', data: '' } });
  };
}

const authCalls = (host, method) => calls.filter((c) => c.host === host && c.method === method);

beforeEach(() => {
  calls = [];
  invalidateSession(); // zera caches de sessão/versão entre testes
  installFetchMock();
});

// ---- pickAuthMode (pura) ----
test('pickAuthMode: >= 6.4 usa header, < 6.4 usa body', () => {
  for (const v of ['6.4.0', '6.4.18', '7.0.19', '7.2.1', '7.4.6', '8.0.0']) {
    assert.equal(pickAuthMode(v), 'header', `${v} deveria ser header`);
  }
  for (const v of ['6.0.44', '6.2.9', '5.4.0', '5.0.0']) {
    assert.equal(pickAuthMode(v), 'body', `${v} deveria ser body`);
  }
});

test('pickAuthMode: versão inválida cai no header (canônico)', () => {
  for (const v of ['', 'abc', undefined, null]) {
    assert.equal(pickAuthMode(v), 'header');
  }
});

// ---- rpc por versão ----
test('7.4: header, 1 requisição, sem body auth', async () => {
  await rpc({ url: 'http://zbx-7.4', apiToken: 'T' }, 'host.get', {});
  const hg = authCalls('http://zbx-7.4', 'host.get');
  assert.equal(calls.filter((c) => c.method === 'apiinfo.version').length, 1);
  assert.equal(hg.length, 1);
  assert.equal(hg[0].hasHeaderAuth, true);
  assert.equal(hg[0].hasBodyAuth, false);
});

test('7.0: header, 1 requisição', async () => {
  await rpc({ url: 'http://zbx-7.0', apiToken: 'T' }, 'host.get', {});
  const hg = authCalls('http://zbx-7.0', 'host.get');
  assert.equal(hg.length, 1);
  assert.equal(hg[0].hasHeaderAuth, true);
});

test('6.0: body direto, 1 requisição (ganho do #126, sem fallback duplo)', async () => {
  await rpc({ url: 'http://zbx-6.0', apiToken: 'T' }, 'host.get', {});
  const hg = authCalls('http://zbx-6.0', 'host.get');
  assert.equal(hg.length, 1);
  assert.equal(hg[0].hasBodyAuth, true);
  assert.equal(hg[0].hasHeaderAuth, false);
});

test('6.4 atrás de proxy que remove o header: fallback header→body (2 req), com sucesso', async () => {
  const r = await rpc({ url: 'http://zbx-6.4-proxy', apiToken: 'T' }, 'host.get', {});
  assert.deepEqual(r, []);
  const hg = authCalls('http://zbx-6.4-proxy', 'host.get');
  assert.equal(hg.length, 2);
  assert.equal(hg[0].hasHeaderAuth, true);
  assert.equal(hg[1].hasBodyAuth, true);
});

test('cache: 2 chamadas na mesma config detectam a versão só 1x', async () => {
  const cfg = { url: 'http://zbx-7.0', apiToken: 'T' };
  await rpc(cfg, 'host.get', {});
  await rpc(cfg, 'host.get', {});
  assert.equal(calls.filter((c) => c.method === 'apiinfo.version').length, 1);
  assert.equal(calls.filter((c) => c.method === 'host.get').length, 2);
});

test('apiinfo.version não leva auth (nem header nem body)', async () => {
  await rpc({ url: 'http://zbx-7.0', apiToken: 'T' }, 'apiinfo.version', {}, { needsAuth: false });
  const v = calls.find((c) => c.method === 'apiinfo.version');
  assert.equal(v.hasHeaderAuth, false);
  assert.equal(v.hasBodyAuth, false);
});
