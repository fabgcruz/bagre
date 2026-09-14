#!/usr/bin/env node
// Servidor MCP do Bagre — transporte stdio (Claude Desktop, Claude Code, SDKs).
//
// stdout é reservado ao protocolo MCP; qualquer log vai para stderr.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerTools } from './tools.js';
import { BASE_URL } from './client.js';

async function main() {
  const server = new McpServer({
    name: 'bagre-mcp',
    version: '0.1.0',
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[bagre-mcp] pronto — falando com a API em ${BASE_URL} (transporte: stdio)`);
}

main().catch((err) => {
  console.error('[bagre-mcp] falha ao iniciar:', err);
  process.exit(1);
});
