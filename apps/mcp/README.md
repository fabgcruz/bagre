# Bagre MCP Server

Expõe o IPAM do Bagre como **tools de [Model Context Protocol](https://modelcontextprotocol.io)**, para que agentes de IA (Claude Desktop, Claude Code, SDKs) consultem e operem a rede em linguagem natural.

É uma **fachada fina** sobre a API REST do Bagre: não reimplementa autenticação nem lógica de IPAM. A autenticação é um token `bagre_…` e o **escopo do token** (`READ_ONLY` / `READ_WRITE`) é enforçado pela própria API — um token read-only recebe `403` em qualquer escrita, então o agente **não consegue** mutar o estado se você não quiser.

> **MVP:** read-only, 12 tools de leitura. Escrita (alocar/reservar IP) fica para uma fase futura com token `READ_WRITE`.

## Guia rápido (5 minutos)

Você precisa de: uma instância do Bagre no ar, **Node ≥ 20** na máquina onde roda seu app de IA, e o app de IA (ex.: Claude Desktop).

1. **Gere a chave** — no Bagre, **Admin → API Tokens** → criar token de escopo **READ_ONLY**. Copie o `bagre_…` (aparece uma vez só).
2. **Baixe e instale** o servidor MCP:
   ```bash
   git clone https://github.com/fabgcruz/bagre.git
   cd bagre/apps/mcp && npm install
   ```
3. **Plugue no Claude Desktop** — edite o `claude_desktop_config.json` (veja o bloco em [Uso com Claude Desktop](#uso-com-claude-desktop)), trocando o caminho, a URL do seu Bagre e o token.
4. **Reinicie o Claude Desktop** e pergunte: *"quais IPs públicos estão ociosos no Bagre?"*. Pronto — a IA responde puxando os dados ao vivo.

> Roda na **sua máquina** (o app de IA inicia o servidor MCP como subprocesso) e fala com o Bagre da empresa pela rede. Não precisa mexer no Docker do servidor.

## Requisitos

- Node.js ≥ 20
- Uma instância do Bagre no ar (API em `http://localhost:3001` por padrão)
- Um token de API gerado em **Admin → API Tokens** (use escopo **READ_ONLY** para o MVP)

## Instalação

```bash
cd apps/mcp
npm install
```

## Configuração

Variáveis de ambiente (veja `.env.example`):

| Variável | Descrição | Padrão |
|---|---|---|
| `BAGRE_API_URL` | URL da API do Bagre (sem barra final) | `http://localhost:3001` |
| `BAGRE_API_TOKEN` | Token `bagre_…` de automação | — (obrigatório) |
| `BAGRE_MCP_CACHE_TTL_MS` | Janela de idempotência: consultas de leitura idênticas dentro desse tempo reusam a resposta (e chamadas concorrentes idênticas compartilham uma única requisição HTTP). `0` desliga o cache. | `5000` |

> **Idempotência:** o cliente MCP guarda um cache curto por requisição para evitar
> **loops caros do agente** — se a IA refizer a mesma consulta na mesma janela, a
> resposta vem do cache em vez de bater na API de novo. Só afeta `GET`; erros nunca
> são cacheados.

## Uso com Claude Desktop

Adicione ao `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "bagre": {
      "command": "node",
      "args": ["/caminho/absoluto/para/bagre/apps/mcp/src/index.js"],
      "env": {
        "BAGRE_API_URL": "http://localhost:3001",
        "BAGRE_API_TOKEN": "bagre_seu_token_read_only"
      }
    }
  }
}
```

## Uso com Claude Code

```bash
claude mcp add bagre \
  --env BAGRE_API_URL=http://localhost:3001 \
  --env BAGRE_API_TOKEN=bagre_seu_token_read_only \
  -- node /caminho/absoluto/para/bagre/apps/mcp/src/index.js
```

## Tools

| Tool | O que faz | Endpoint |
|---|---|---|
| `search` | Busca global por IPs, subnets, sites e devices | `GET /api/search` |
| `list_sites_with_subnets` | Mapa geral: sites e suas subnets | `GET /api/sites` |
| `get_subnet` | Detalha uma subnet (usados/livres) | `GET /api/subnets/:id` |
| `list_subnet_ips` | IPs de uma subnet (filtro status/busca) | `GET /api/subnets/:id/ips` |
| `subnet_next_free_ip` | Próximo IP livre da subnet | `GET /api/subnets/:id/next-free-ip` |
| `subnet_utilization_history` | Histórico de ocupação da subnet | `GET /api/subnets/:id/utilization-history` |
| `cidr_parse` | Analisa um CIDR + overlaps | `GET /api/cidr/parse` |
| `cidr_next_free` | Próximos blocos CIDR livres num pai | `GET /api/cidr/next-free` |
| `pending_discoveries` | Descobertas aguardando aprovação | `GET /api/pending-discoveries` |
| `pending_discoveries_stats` | Contagens de descobertas por status | `GET /api/pending-discoveries/stats` |
| `finops_idle_public_ips` | IPs públicos ociosos + custo (propõe) | `GET /api/cloud/finops/idle-public-ips` |
| `stats` | Estatísticas gerais do IPAM | `GET /api/stats` |

Todas read-only. As tools que exigem `ADMIN` (audit, network-health, status de integrações) ficam para uma fase futura com token `READ_WRITE`.

## Exemplos de perguntas

- _"Existe algum host chamado `db-prod-01` na rede?"_
- _"Procure o IP 10.20.0.5 e me diga a que subnet e site pertence."_

## Segurança

- Prefira tokens **READ_ONLY** para agentes — a API bloqueia escrita no servidor, não depende do cliente.
- Tokens nunca acessam `/api/users` nem `/api/api-tokens` (sem escalonamento de privilégio).
- Em ambiente `DEMO`, a API é read-only global — qualquer escrita retorna `403`.
- Logs vão para **stderr**; `stdout` é reservado ao protocolo MCP.
