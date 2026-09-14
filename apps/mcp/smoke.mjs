// Smoke test: conecta um cliente MCP real ao servidor via stdio,
// lista as tools e chama `search`. Não precisa da API no ar — sem BAGRE_API_URL
// acessível, o `search` deve retornar erro TRADUZIDO (prova o fluxo ponta a ponta).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['src/index.js'],
  env: { ...process.env, BAGRE_API_URL: 'http://127.0.0.1:59999', BAGRE_API_TOKEN: 'bagre_dummy' },
});

const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('TOOLS (%d):', tools.length, tools.map((t) => t.name));

const res = await client.callTool({ name: 'search', arguments: { q: 'db-prod-01' } });
console.log('SEARCH isError:', res.isError === true);
console.log('SEARCH text:', res.content?.[0]?.text);

await client.close();
