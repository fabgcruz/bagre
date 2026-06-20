# Integrações

> Como conectar o IPAM a sistemas externos: Zabbix, Microsoft Entra ID (SSO), e ingestão genérica.
> **Autor**: Fabricio Cruz

---

## Visão geral

```
   ┌────────────┐   sync periódico    ┌──────────┐
   │  Zabbix    │ ◄──────────────────│  IPAM    │
   └────────────┘                     │          │
                                      │          │
   ┌────────────┐   ingest API        │          │
   │  Scanners  │ ──────────────────►│          │
   │ nmap/OTEL  │                     │          │
   └────────────┘                     │          │
                                      │          │
   ┌────────────┐   /metrics scrape   │          │
   │ Prometheus │ ◄──────────────────│          │
   └────────────┘                     │          │
                                      │          │
   ┌────────────┐   OIDC SSO          │          │
   │ Entra ID   │ ◄──────────────────│          │
   └────────────┘                     └──────────┘
```

Todas as integrações são **configuráveis pela UI** (zero env var para credenciais).

---

## Zabbix

A integração mais valiosa: o Zabbix já sabe quais IPs estão vivos, quais hosts existem, qual OS, etc. O IPAM consome essa informação via API JSON-RPC.

### Por que faz sentido

- **Sem carga adicional na rede**: o Zabbix já está coletando, só estamos lendo
- **Sem agentes novos**: nada a instalar
- **Enriquecimento automático**: tipo de equipamento, OS, vendor, MAC vêm do `host.inventory`
- **Detecção de stale**: IPs que sumiram do Zabbix viram alerta no IPAM
- **Detecção de fantasmas**: IPs vivos no Zabbix mas não cadastrados no IPAM

### Configuração passo a passo

#### 1. No Zabbix
Crie um API Token (recomendado, Zabbix 5.4+):
- Administration → Users → Selecione o usuário → **API tokens** → **Create API token**
- Permissões necessárias: leitura em `Host` e `Hostgroup`
- Copie o token gerado

Alternativa: usar usuário/senha (Zabbix antigo). Crie um usuário read-only com permissão em todos os hosts.

#### 2. No IPAM
1. Sidebar → **Integrações** → card Zabbix → **Configurar**
2. **URL do Zabbix**: ex: `https://zabbix.empresa.local` (sem `/api_jsonrpc.php` no final)
3. **API Token**: cole o token
   - Ou expanda **"ou usar usuário/senha"** e preencha
4. **Intervalo (minutos)**: padrão 15
5. **Marcar como stale após (dias)**: padrão 7
6. **Filtrar por grupos do Zabbix** (opcional): ex: `Production, Equinix-SP3`
7. Clica **Salvar**
8. Clica **Testar conexão** → toast verde "Conexão e auth OK · Zabbix 7.x"
9. Clica **Sincronizar agora** → toast com estatísticas (`X hosts · Y IPs atualizados · Z fantasmas`)
10. Clica **Habilitar sincronização** → vira automático a cada N minutos

### O que é sincronizado

Para cada host monitorado pelo Zabbix:
- **Endereço** (`host.interface.ip`)
- **Hostname** (`host.name` ou `host.host`)
- **Tipo** (derivado de `inventory.type`, OS e vendor)
- **Função** (concatenação dos grupos do Zabbix)
- **OS** (`inventory.os_full` ou `inventory.os`)
- **Vendor** (`inventory.vendor`)
- **Modelo** (`inventory.model`)
- **MAC Address** (`inventory.macaddress_a`)
- **Status** (`USED` se o host está enabled, `RESERVED` se disabled)
- **lastSeenAt** (timestamp da sync) e **lastSeenSource** (`zabbix`)

### Mapeamento "tipo de equipamento"

A função `deriveType` em `apps/api/src/integrations/zabbix.js` decide o tipo amigável:

| Critério | Resultado |
|---|---|
| `inventory.type` contém "router" | Roteador |
| `inventory.type` contém "switch" | Switch |
| `inventory.type` contém "firewall" | Firewall |
| `inventory.type` contém "workstation" | Workstation |
| `inventory.type` contém "printer" | Impressora |
| `inventory.type` contém "storage" | Storage |
| `inventory.os` contém "Windows" | Servidor Windows |
| `inventory.os` contém "Linux/Ubuntu/Debian/CentOS/RHEL" | Servidor Linux |
| `inventory.vendor` é Cisco/Mikrotik | Equipamento da fabricante |
| `inventory.vendor` é Fortinet | Firewall |
| (fallback) | "Host" ou `inventory.type` literal |

### Status da integração

`/admin/integrations` mostra o card Zabbix com:
- Badge **Funcionando** / **Configurado · pausado** / **Com erro** / **Não configurado**
- Última sync (data + ✓/✗)
- Estatísticas (hosts · updated · ghosts)
- IPs alimentados pelo Zabbix
- Botão **Testar agora** (live test)

### Troubleshoot

**"Zabbix RPC: Incorrect user name or password"**
→ Token inválido ou senha errada. Tente um teste manual via curl.

**"Zabbix HTTP 502/503"**
→ URL inacessível do contêiner do IPAM. Verifique se o nome DNS resolve do contêiner. Se for IP corporativo via VPN, lembre que o contêiner não está na sua VPN do Mac (rodaria em Linux na rede final).

**"sync ok mas updated=0"**
→ Os IPs do Zabbix não batem com nenhum range cadastrado no IPAM. Cadastre as subnets que cobrem esses IPs primeiro.

**"sync ok com muitos ghosts"**
→ Os IPs vivos no Zabbix não estão cadastrados em subnets. Pode ser legítimo (subnets faltando) ou indicar problema de inventário.

### Ambiente de testes local (sem Zabbix real)

O repositório inclui um overlay `docker-compose.zabbix-dev.yml` que sobe um
Zabbix completo na sua máquina:

```bash
docker compose -f docker-compose.yml -f docker-compose.zabbix-dev.yml up -d
# aguarde ~60s para o Zabbix inicializar

node scripts/seed-zabbix-dev.mjs
# popula 17 hosts fictícios com inventário rico (OS, vendor, MAC)

# UI Zabbix: http://localhost:8080  (Admin / zabbix)
# No IPAM, configure URL: http://bagre-zabbix-web:8080
```

Os hosts fictícios incluem servidores Linux, Windows, switches Cisco,
firewalls Fortigate e workstations Lenovo/Apple — material rico para
demonstrar a integração ao vivo.

---

## SSO Microsoft Entra ID

OIDC com qualquer Identity Provider compatível (Entra ID / Azure AD por padrão).

### Custo

**Zero** no tier Free do Entra ID. SSO de aplicação custodiada não cobra.
Apenas Conditional Access avançado, PIM e risk-based MFA exigem P1/P2 (~US$ 6/usuário/mês), e isso é opcional.

### Configuração passo a passo

#### 1. No Microsoft Entra ID
1. Portal Azure → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Nome: `Bagre`
3. **Redirect URI**: copie do passo 2 abaixo
4. Após criar, anote: **Application (client) ID** e **Directory (tenant) ID**
5. Em **Certificates & secrets** → **New client secret**, gere um secret e copie o valor

#### 2. No IPAM
1. Sidebar → **SSO / Entra ID** (`/admin/sso`)
2. **Redirect URI**: já vem preenchida (`http://localhost/api/auth/sso/callback` em dev). **Copie** e cole no Entra ID
3. **Issuer URL**: `https://login.microsoftonline.com/{TENANT_ID}/v2.0`
4. **Client ID**: cole
5. **Client Secret**: cole o secret gerado
6. (Opcional) **Grupos que recebem perfil ADMIN**: cole os Object IDs dos grupos do Entra (separados por vírgula). Usuários nesses grupos viram ADMIN automaticamente. Se vazio, todo novo usuário SSO é READER por padrão (admin pode promover manualmente)
7. **Perfil padrão para novos usuários**: READER
8. **Provisionamento automático**: marcado (cria usuário no primeiro login)
9. Clica **Salvar configurações**
10. Clica **Testar conexão** → "OK — issuer https://login.microsoftonline.com/..."
11. Clica **Habilitar SSO**

A partir daí, a tela de login mostra um botão **"Entrar com Microsoft"** com o logo quadricolor. Quando clicado, redireciona ao Entra ID, faz o handshake OIDC, retorna ao IPAM autenticado.

### Comportamento

- **Primeiro login SSO**: cria usuário automaticamente no IPAM com `authProvider=oidc` e role mapeada
- **Login subsequente**: atualiza grupos (caso o usuário tenha entrado em novos grupos no Entra), atualiza nome se mudou
- **Login local sempre disponível** como fallback — proteção contra falha do IdP
- **Auditoria**: cada login SSO gera entrada no AuditLog com `actor=email` e `action=login`

### Múltiplos providers

O sistema é estruturado para suportar múltiplos providers no futuro (Auth0, Keycloak, etc). Hoje só Entra ID/OIDC está implementado.

---

## Autenticação LDAP / Active Directory

Login com as credenciais do **Active Directory on-premise** (ou qualquer servidor LDAP) por **bind direto** — sem precisar de broker (Keycloak/ADFS). É a paridade com phpIPAM/NetBox para quem padroniza acesso via AD.

> Quando usar LDAP vs SSO/OIDC: use **LDAP/AD** se você quer que o usuário digite usuário+senha do domínio direto na tela do Bagre, contra um DC on-prem. Use **SSO/OIDC** (seção acima) para Entra ID na nuvem ou login federado com redirect. Os dois podem coexistir com o login local.

### Como funciona

1. O Bagre conecta com uma **conta de serviço** (bind DN) e **busca** o usuário pelo filtro (ex.: `sAMAccountName`).
2. Faz um **re-bind como o próprio usuário** com a senha digitada — é assim que a credencial é validada (não há comparação de hash; quem valida é o AD).
3. Lê os **grupos** do usuário (`memberOf`) e mapeia para papel **ADMIN** ou **READER**.
4. No 1º login, **provisiona** o usuário local espelhando o AD (`authProvider=ldap`).

### Configuração passo a passo

1. Sidebar → **Integrações** → card **Autenticação AD/LDAP** → **Configurar** (`/admin/ldap`).
2. **Seção Conexão:**
   - **URL**: `ldap://dc.corp.local:389` (ou `ldaps://dc.corp.local:636` para TLS).
   - **StartTLS**: marque se for usar `ldap://` na porta 389 com upgrade para TLS (alternativa ao `ldaps://`). Em produção, **use LDAPS ou StartTLS** — sem isso a senha trafega em claro.
   - **Bind DN** (conta de serviço): `CN=svc-bagre,OU=Service,DC=corp,DC=local`.
   - **Senha do bind**: a senha da conta de serviço (fica mascarada; nunca é devolvida crua à UI).
   - **Base DN**: `DC=corp,DC=local`.
3. **Seção Busca de usuário:**
   - **Filtro**: `(sAMAccountName={username})` para AD. Em OpenLDAP costuma ser `(uid={username})` ou `(cn={username})`. O `{username}` é substituído pelo que o usuário digita (com escape anti-injection).
   - **Atributo de e-mail** / **nome**: `mail` / `displayName` (padrões do AD).
4. **Seção Grupos e papéis:**
   - **Atributo de grupos**: `memberOf` (padrão do AD).
   - **Grupos que concedem ADMIN**: os **DNs** dos grupos, um por linha. Ex.: `CN=ipam-admins,OU=Groups,DC=corp,DC=local`. Membros viram ADMIN; os demais recebem o papel padrão.
   - **Papel padrão**: READER.
   - **Provisionar automaticamente**: marcado (cria o usuário no 1º login).
5. Clique **Testar conexão** → deve responder "OK — conectou em ldap://…".
6. Marque **Habilitar** e salve.

A partir daí, a tela de login aceita usuário+senha do domínio. (No demo público a config aparece preenchida como exemplo, com a senha mascarada.)

### Comportamento e precedência

- **Precedência de login**: local → **LDAP** → OIDC. O login local e o SSO continuam funcionando em paralelo (**anti-lockout**: se o servidor LDAP cair, o admin local ainda entra).
- **1º login**: cria o usuário com papel mapeado pelos grupos. **Logins seguintes**: revalidam grupos/papel.
- **Auditoria**: cada login gera entrada no AuditLog.

### Segurança

- Senha do service account **mascarada** em respostas e logs (a API só devolve `hasBindPassword`).
- **Anti LDAP-injection**: o `{username}` é escapado conforme RFC 4515.
- **Rejeita senha vazia** (evita o "bind anônimo bem-sucedido" que viraria bypass de autenticação).
- A busca deve retornar **exatamente um** usuário, senão o login é negado.

### Troubleshoot

| Sintoma | Causa provável |
|---|---|
| "Testar conexão" falha com timeout | URL/porta errada, firewall, ou o DC não aceita a porta informada |
| Conecta mas todo login dá 401 | filtro de busca errado (ex.: `uid` num AD que usa `sAMAccountName`), ou Base DN não cobre os usuários |
| Login OK mas usuário não vira ADMIN | DN do grupo em "Grupos ADMIN" não bate **exatamente** com o `memberOf` (compare o DN completo, case-insensitive) |
| "socket disconnected before TLS" | usou `ldaps://` num servidor que só fala `ldap://` (ou vice-versa); confira porta 389 vs 636 e a opção StartTLS |

### Ambiente de testes local (sem AD real)

O overlay do demo sobe um **OpenLDAP** (slapd) a partir da imagem oficial do Debian, com schema estilo AD (`sAMAccountName` + overlay `memberOf`) e usuários `alice`/`bob`. Veja `infra/demo/openldap/` e `docker-compose.demo.yml`. Útil para validar a integração de ponta a ponta antes de plugar no DC de verdade.

---

## Ingestão externa (scanners, OTEL, scripts)

Para atualizar o IPAM a partir de **qualquer ferramenta externa** sem precisar de uma conta de usuário, use os endpoints de ingestão.

### Auth
Header `X-Ingest-Token: $INGEST_TOKEN`. Configurável em `.env` (variável `INGEST_TOKEN`).

### Endpoint principal

```
POST /api/ingest/discoveries
Content-Type: application/json
X-Ingest-Token: <INGEST_TOKEN>

{
  "discoveries": [
    {
      "address": "10.150.0.10",
      "hostname": "srv-prd-01",
      "type": "Server",
      "function": "Web",
      "macAddress": "00:1A:A0:11:22:33",
      "osInfo": "Ubuntu 22.04",
      "vendor": "Dell",
      "model": "PowerEdge R740",
      "status": "USED",
      "source": "nmap-scanner",
      "siteCode": "BAGRE-SP3"     // opcional, desambigua se IP em múltiplas subnets
    }
  ]
}
```

Comportamento:
- Faz match por `address` em todas as subnets (ou filtra por `siteCode` / `subnetCidr` se fornecido)
- Atualiza apenas campos enviados (não apaga o que existe)
- IPs não cadastrados retornam em `unmatched` (fantasmas)
- Cada update cria entrada no AuditLog com `action=ingest` e `actor=$source`

### Heartbeat (presença/queda)

Para ferramentas de monitoring que querem só registrar liveness:

```
POST /api/ingest/heartbeat
{ "address": "10.150.0.10", "alive": true, "source": "blackbox-exporter" }
```

Atualiza `lastSeenAt`, opcionalmente o campo `notes`.

### Exemplo: cron de scanner próprio

```bash
#!/bin/bash
# Scaneia e empurra para o IPAM
for IP in $(nmap -sn 10.150.0.0/24 -oG - | grep Up | awk '{print $2}'); do
  curl -s -X POST http://ipam.empresa.local/api/ingest/discoveries \
    -H 'Content-Type: application/json' \
    -H "X-Ingest-Token: $INGEST_TOKEN" \
    -d "{\"discoveries\":[{\"address\":\"$IP\",\"source\":\"nmap-cron\"}]}"
done
```

---

## Métricas Prometheus

Endpoint público em `/metrics` (porta 3001 do API).

### Métricas expostas

| Métrica | Tipo | Labels | Descrição |
|---|---|---|---|
| `bagre_ip_count` | gauge | `status,site,subnet` | IPs por status em cada subnet |
| `bagre_subnet_utilization_ratio` | gauge | `site,subnet` | Uso da subnet (0..1) |
| `bagre_subnet_total` | gauge | — | Total de subnets |
| `bagre_site_total` | gauge | — | Total de sites |
| `bagre_process_*` | counter/gauge | — | Métricas padrão do Node.js (CPU, heap, GC) |

### Scrape config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'bagre'
    metrics_path: /metrics
    static_configs:
      - targets: ['bagre-api:3001']
```

### Dashboards Grafana sugeridos

- **Capacity heatmap**: `bagre_subnet_utilization_ratio` por site/subnet
- **Top 10 subnets cheias**: `topk(10, bagre_subnet_utilization_ratio)`
- **Crescimento de IPs em uso**: `rate(bagre_ip_count{status="USED"}[7d])`
- **IPs livres restantes**: `sum(bagre_ip_count{status="FREE"}) by (site)`

### Alertas Prometheus sugeridos

```yaml
- alert: SubnetQuaseCheia
  expr: bagre_subnet_utilization_ratio > 0.85
  for: 30m
  annotations:
    summary: "Subnet {{ $labels.subnet }} ({{ $labels.site }}) com {{ $value }}% de uso"

- alert: SiteSemIPsLivres
  expr: sum by (site) (bagre_ip_count{status="FREE"}) < 10
  for: 1h
  annotations:
    summary: "Site {{ $labels.site }} com menos de 10 IPs livres"
```

---

## OTEL (OpenTelemetry)

O sistema **não emite traces OTEL hoje** (não há instrumentação no código). Mas é um próximo passo natural.

Como começar quando for o caso:
1. Adicionar `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`
2. Iniciar o SDK no topo de `src/index.js`
3. Apontar para um **OTLP collector** (Tempo, Jaeger, etc) via env var `OTEL_EXPORTER_OTLP_ENDPOINT`
4. Auto-instrumentação cobre Fastify, Prisma, fetch automaticamente

Estimativa: 2-3 horas para integrar.

---

## Como adicionar uma integração nova

A estrutura é replicável:

1. **Backend**: criar `apps/api/src/integrations/<nome>.js` com:
   - `getConfig()` (lê do DB)
   - `testConnection(cfg)` (verifica auth)
   - `sync<Algo>(cfg)` (executa a operação)
   - `startScheduler(log)` (timer interno opcional)
2. **Schema**: adicionar `<Nome>Config` no `schema.prisma` (single-row)
3. **Rotas admin**: criar `apps/api/src/routes/<nome>.js` com `GET/PATCH/POST` para config + test + sync
4. **Frontend**: criar página `apps/web/src/pages/<Nome>Settings.jsx` (form + botões)
5. **Aggregação**: incluir o status da nova integração em `routes/integrations-status.js`
6. **Sidebar**: adicionar item em `Layout.jsx` se for página dedicada

Pattern já comprovado com Zabbix e Entra ID.
