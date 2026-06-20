# Changelog

Linha do tempo das mudanças do Bagre. Segue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [SemVer](https://semver.org).

Quem está testando o Bagre pode acompanhar aqui o que mudou em cada versão — features adicionadas, removidas, renomeadas, bugs corrigidos.

---

## [Unreleased]

Mudanças que estão em `main` e ainda não entraram em release oficial.

### Adicionado
- **Autenticação LDAP / Active Directory nativa** ([#48](https://github.com/fabgcruz/bagre/issues/48)) — provider de bind direto (search-then-bind, valida a senha re-bindando como o usuário), mapeamento **grupo do AD → papel** (`memberOf` → ADMIN/READER), provisionamento no 1º login, suporte a `ldaps://`/StartTLS. Configurável na nova tela **Integrações → Autenticação AD/LDAP** (`/admin/ldap`), com botão **Testar conexão**. Login local e SSO continuam em paralelo (anti-lockout).
- **Card "Autenticação AD/LDAP"** na tela de Status das Integrações, ao lado de Zabbix/Prometheus/PowerDNS/SSO.
- **Selo de origem da conta** (LDAP/AD · SSO · Local) no Perfil e na coluna "Origem" da lista de Usuários — evidencia que o login veio do diretório (mostra DN + grupos).
- **Demo:** opção de entrar por **conta de domínio (AD/LDAP)** na tela de login (contas de teste).
- **Demo populado:** Catálogos (ranges mestre + VLANs de datacenter) e regras de Validação agora têm exemplos, e a config LDAP aparece preenchida como exemplo funcional.

### Segurança / hardening
- **Demo 100% somente-leitura:** trava global no servidor bloqueia toda escrita (`POST/PUT/PATCH/DELETE`) exceto o login; a UI mostra o aviso **"Somente demonstração"** ao tentar criar/editar/excluir — nada é alterado.
- **Mascaramento de segredos não vaza mais o sufixo** (Zabbix/DNS/Prometheus/OIDC usavam `••••••••`+últimos4; agora é placeholder fixo).
- **`/metrics` bloqueado** no origin público do demo; **CSP** e **Permissions-Policy** adicionados; **CORS** configurável via `CORS_ORIGIN` (deixa de refletir qualquer origem com credentials).
- **Rate-limit** de login configurável (`LOGIN_RATE_MAX`; demo fixa 12/5min) e estendido a `/api/auth/reset` e `/change-password`.
- **SSO callback:** a origem do redirect passa a vir de fonte server-side confiável (`APP_BASE_URL`/`redirectUri`), não dos headers do request, e o `next` é sanitizado — corrige open-redirect e vazamento de token na URL.
- **Anti-SSRF nas integrações:** ao salvar a URL de Zabbix/Prometheus/PowerDNS, destinos **link-local/metadata** (`169.254.0.0/16`, `fd00:ec2::254`) são bloqueados; redes privadas internas continuam permitidas (`INTEGRATION_URL_STRICT=true` trava tudo).

---

## [1.0.0] — 2026-06-17

**Tema:** Marco 1.0 — pronto para produção, com site oficial e demo público ao vivo.

A v1.0 consolida o conjunto já maduro do Bagre (IPAM central, IPv6 first-class, cloud sync multi-provider, FinOps, descoberta via Zabbix/Prometheus, DNS sync, validation engine, calculadora CIDR, bulk ops, histórico de capacidade, RBAC e SSO) como release estável de produção. O foco do ciclo foi estabilidade, demonstrabilidade e polimento — sem novas features de IPAM.

### Adicionado
- **Ambiente de demonstração (`DEMO_MODE`)** — instância pública compartilhada com login em 1 clique (perfis Admin e Leitor), banner de demonstração e dados reiniciados diariamente às 04h (BRT). No modo demo o formulário de e-mail/senha (e SSO/cadastro) fica oculto — entra-se só pelos perfis demo. Alvo das integrações fixado na instância interna (proteção anti-SSRF) e sincronização inicial automática em background (servidor sobe sem espera).
- **Demo de descoberta de hosts end-to-end** — host descoberto → pendência → aprovação em 1 clique, alimentado por **Zabbix** e **Prometheus** simultaneamente, mais **PowerDNS** (DNS sync) na mesma instância.
- **Coluna "Fonte" em Aprovações** — cada descoberta pendente mostra de onde veio (Zabbix, Prometheus, Ingest, Manual) com badge colorido.
- **IP de origem no log de auditoria** — eventos passam a registrar o IP de quem fez a ação.
- **Descrições claras nos cards de integração** — texto curto e objetivo explicando o que cada integração faz e que descobertas viram pendências de aprovação.
- **Site oficial** em [bagre.dev](https://bagre.dev) e demo público em [demo.bagre.dev](https://demo.bagre.dev).

### Segurança / hardening
- Revisão geral de marca e limpeza de referências legadas em código, docs, seeds e branding.
- Demo atrás de Cloudflare + nginx (rate-limit, headers de segurança, TLS de origem) com o alvo das integrações imutável no modo demo.

---

## [0.5.0] — 2026-05-28

**Tema:** Cleanup completo do backlog + integrações maduras com UI.

Release que fecha 8 issues numa tacada, entrega DNS sync e validation engine end-to-end (backend + UI), CIDR avançado, bulk ops, IPv6 first-class, importação universal, histórico de capacidade, primeira correção de bug reportado pela comunidade, e design specs pra próximos grandes projetos.

### UI nova
- **DNS Settings** (`/admin/integrations/dns`) — picker de provider (PowerDNS ativo; BIND/Route53/Cloudflare como "em breve"), config form, test connection, **preview do diff** com cards coloridos por ação, e Sync agora com confirmação.
- **Validação** (`/admin/validation`) — lista de regras com toggle de enabled inline, modal de criação/edição com picker visual de tipo, escopo, severity, e editor JSON com hint do shape esperado.
- **Integrações status** agrega DNS como mais um card no painel consolidado.

### Corrigido
- **Criar subnet com CIDR ≥ 128.0.0.0 dava erro de "expandiria para 4294967552 IPs"** ([#29](https://github.com/fabgcruz/bagre/issues/29), reportado por @ruiluna) — bug antigo no `parseIpv4Cidr` em `apps/api/src/cidr.js`. JS faz `&` em int32 signed; sem `>>> 0` no resultado, qualquer network com bit alto setado (192.168.x.x, 172.16.x.x, e qualquer público) voltava como negativo, fazendo `broadcast - network + 1` explodir pra ~4B. 10.x.x.x funcionava porque é abaixo do bit de sinal. Adicionado `>>> 0` na linha de cálculo do network.

### Adicionado
- **Sistema de validação de subnets** ([#27](https://github.com/fabgcruz/bagre/issues/27)) — 4 regras built-in (`no-overlap`, `within-master`, `size-range`, `name-pattern`), severity `error` (bloqueia) ou `warning` (só avisa), scope global / por site / por provider. Engine roda em `POST /api/subnets` antes de qualquer side-effect — erros retornam HTTP 422 com `violations[]`; warnings retornam no payload do subnet criado. Endpoint `POST /api/validation/test-subnet` permite preview sem criar. CRUD admin em `/api/validation/rules`. Plugin custom em arquivo via `apps/api/plugins/validation/*.js` na próxima iteração.
- **Gerador de tutoriais via Playwright** ([#24](https://github.com/fabgcruz/bagre/issues/24) parcial) — `scripts/generate-tutorial-screenshots.mjs` automatiza captura de screenshots + montagem de markdown narrativo. 3 tutoriais base prontos: `quickstart`, `connect-aws`, `cidr`. `docs/tutorials/README.md` documenta como rodar, estender e adicionar novos tutoriais. CI workflow + tutoriais adicionais ficam pra próxima iteração.
- **DNS integration — PowerDNS** ([#17](https://github.com/fabgcruz/bagre/issues/17)) — push de hostnames Bagre → zona DNS via API do PowerDNS. Schema novo `DnsConfig` (provider, baseUrl, apiKey, defaultZone, etc), integração em `apps/api/src/integrations/dns/powerdns.js` com `testConnection`, `previewSync` (diff) e `applySync` (PATCH no PowerDNS). Records gerenciados pelo Bagre são marcados com comment `bagre-managed` pra evitar pisar em records manuais existentes. Endpoints admin: `GET /api/admin/dns-config`, `PATCH`, `POST /test`, `GET /preview`, `POST /sync`. BIND, Route53 e Cloudflare na próxima iteração (campo `provider` no schema já permite distinguir). UI vem na sequência.
- **Design specs para Terraform Provider** ([#15](https://github.com/fabgcruz/bagre/issues/15)) e **Kubernetes Operator** ([#16](https://github.com/fabgcruz/bagre/issues/16)) em `docs/terraform-provider-design.md` e `docs/kubernetes-operator-design.md`. As implementações vivem em repositórios separados (Go) — esses documentos definem schema dos resources/CRDs, fluxo de auth, integração nativa (annotation do Service pro K8s) e roadmap. Quem quiser implementar tem rascunho pronto pra discussão antes de codar.
- **Importação universal — fase 1** ([#13](https://github.com/fabgcruz/bagre/issues/13)) — novo endpoint `POST /api/import` admin-gated que aceita 3 formatos via upload (multipart) ou JSON body inline:
  - **JSON** — formato seed nativo do Bagre (mesmo shape de `seed.json`)
  - **CSV** — tabular com colunas `site_code, site_name, subnet_name, subnet_cidr, subnet_vlan, address, hostname, type, function, status, notes` (1 IP por linha; sites e subnets auto-agrupadas). Parser CSV inline minimalista (suporta aspas).
  - **XLSX** — primeira aba tratada como CSV-like (mesmas colunas reconhecidas)
  - Limite 25MB por upload. Função `importSeed(seed)` extraída do legacy `runImport` pra reuso.
- YAML e NetBox export — não implementados nesta iteração (issue aberta pra continuar).
- **Suporte IPv6 first-class — fase 1** ([#10](https://github.com/fabgcruz/bagre/issues/10)) — schema já era agnóstico, agora os helpers de CIDR também. `apps/api/src/cidr.js` ganha `parseIpv6Cidr` (BigInt 128-bit), `detectIpVersion`, `normalizeAddress` (compactação canônica `::`). `expandCidr` retorna `[]` para IPv6 — subnets v6 são criadas sem pré-enumeração de IPs (um /64 tem 18.4 quintilhões de endereços; enumerar não escala).
- **`POST /api/subnets/:id/ips`** — novo endpoint para criar IPs ad-hoc em uma subnet. Único caminho viável para alocar endereços IPv6, mas também serve pra IPv4 quando o operador precisa adicionar um IP fora do range pré-criado (ex: IPs secundários em interfaces multi-tap).
- **`GET /api/cidr/parse`** suporta IPv6 — retorna network, last address e total ("2^N"). Operações split/merge/next-free ainda são IPv4-only (próxima iteração).
- **Screenshots no README** ([#9](https://github.com/fabgcruz/bagre/issues/9)) — galeria 2x2 com dashboard, subnet detail, calculadora CIDR e cloud accounts, capturados via Playwright em viewport 1440x900. Repositório agora mostra visualmente o que o produto faz antes do leitor rolar.

### Mudado
- `next-free-ip` na subnet retorna mensagem específica quando a subnet é IPv6 (em vez do genérico "nenhum IP livre"), apontando o operador para o novo endpoint de criação ad-hoc.

---

## [0.4.0] — 2026-05-28

**Tema:** Multi-cloud completo — AWS + Azure + GCP.

Marco do roadmap. Bagre agora é **single pane of glass** para IPs em qualquer combinação de AWS, Azure e GCP, com detecção automática de IPs públicos ociosos em todos os três (relatório FinOps unificado em USD/mês).

### Adicionado
- **Cloud sync Azure** ([#20](https://github.com/fabgcruz/bagre/issues/20)) — provider implementado via REST puro contra `management.azure.com`, sem `@azure/*` SDK. Auth Service Principal (App Registration + client secret + tenant ID), token OAuth2 client_credentials cacheado em memória. Sincroniza VNets/subnets, Network Interfaces (private IPs) e Public IPs (incluindo unassociated — base do FinOps no Azure).
- **Cloud sync GCP** ([#21](https://github.com/fabgcruz/bagre/issues/21)) — provider implementado via REST puro contra `compute.googleapis.com`, sem `@google-cloud/*` SDK. Auth Service Account JSON key com **JWT RS256 manual** (Node crypto.createSign), depois OAuth2 JWT bearer (RFC 7523). Sincroniza subnetworks (aggregated/all-regions), NICs de instâncias com private + ephemeral public IPs, e endereços reservados (static EXTERNAL com `users:[]` = FinOps gold).
- Sync engine passa `account.scope` como 3º argumento de `listSubnets`/`listIps`. Azure/GCP usam (subscription / project_id); AWS ignora. Azure/GCP itera 1 vez (aggregated endpoints cobrem todas regions); AWS itera as regions configuradas.
- UI: picker de provider habilita Azure e GCP (saem do "em breve"). Modal de adicionar conta tem campos contextuais por provider — AWS (Access Key OR Assume Role), Azure (Tenant + Client + Secret) e GCP (Service Account JSON em textarea, ~8 linhas).
- PROVIDER_INFO de Azure e GCP ganhou texto inline da role/policy mínima e link pra doc oficial do IAM de cada provider.

### Notas operacionais
- Credenciais cloud continuam criptografadas AES-256-GCM no DB (CLOUD_CREDS_KEY obrigatória).
- Custo estimado/h por provider (em `cloud-finops.js`): AWS 0.005, Azure 0.005, GCP 0.010 — valores de referência; operador deve confirmar com billing real.
- O endpoint FinOps `/api/cloud/finops/idle-public-ips` continua provider-agnostic: filtra por `ipKind=PUBLIC` + `source startsWith 'cloud:'` + `cloudMetadata.associated === false`. Azure (`ipConfiguration === null`) e GCP (`users:[]`) populam essa flag automaticamente.

### Sem breaking changes
Schema, env vars, endpoints REST e UI da v0.3.x continuam funcionando idênticos. Upgrade é só `git pull && docker compose build api web && docker compose up -d`.

---

## [0.3.2] — 2026-05-27

**Tema:** Histórico de capacidade — capacity planning fica visual.

Patch release com a visualização temporal do uso de cada subnet. Decisão de "preciso pedir mais um /24" deixa de ser intuição e passa a ter tendência mensurável.

### Adicionado
- **Histórico temporal de utilização de subnet** ([#11](https://github.com/fabgcruz/bagre/issues/11)) — gráfico SVG inline na página de detalhes da subnet mostrando IPs em uso ao longo do tempo (7d / 30d / 90d). Indicador de tendência (subindo / estável / descendo), linha tracejada da capacidade total como referência, tooltip em cada ponto. Botão "Capturar agora" pra forçar snapshot fora do ciclo do scheduler.
- Schema novo: `SubnetUtilizationSnapshot` (subnetId, takenAt, ipCount, usedCount, reservedCount, freeCount) com índice em (subnetId, takenAt).
- Scheduler periódico em `apps/api/src/integrations/utilization-snapshot.js` — roda a cada `SNAPSHOT_INTERVAL_MINUTES` (default 60), pula subnets com snapshot recente e subnets sem IPs.
- Endpoints: `GET /api/subnets/:id/utilization-history?days=N` (max 365d) e `POST /api/subnets/:id/utilization-snapshot` (admin pode forçar manual).

### Notas
- Gráfico é renderizado em SVG inline puro — zero dependência nova (sem chart lib).
- Snapshots novos começam a aparecer logo após o upgrade. Como histórico é construído por captura, leva ~7 dias rodando pra ver tendência real de uma semana.
- Retention policy ainda não implementada — para uso em larga escala (10k+ subnets) considerar adicionar limpeza periódica em uma release futura.

---

## [0.3.1] — 2026-05-27

**Tema:** Calculadora CIDR avançada e operações em lote.

Patch release focada em melhorar a experiência operacional diária sem breaking changes.

### Adicionado
- **Operações em lote na lista de IPs** ([#14](https://github.com/fabgcruz/bagre/issues/14)) — checkboxes por linha + master checkbox no header + barra de ação flutuante quando ≥1 selecionado. Três ações: Reservar (status RESERVED), Liberar (limpa hostname/tipo/função/notas/device, status FREE) e Editar campos em massa (modal com tipo/função/notas). Endpoint `POST /api/ips/bulk` admin-gated, cap de 500 IPs por chamada. Status é auto-promovido pra USED se algum campo é preenchido em IPs FREE.
- **Calculadora CIDR avançada** ([#12](https://github.com/fabgcruz/bagre/issues/12)) — página `/cidr` agora tem 4 tabs: **Análise** (parse com detecção de overlap no IPAM e match de master range), **Dividir** (quebra um CIDR em N subnets menores, marcando quais já estão em uso), **Próximas livres** (sugere subnets disponíveis dentro de um parent), **Supernet** (acha o menor CIDR que cobre vários inputs).
- Endpoints REST novos: `GET /api/cidr/parse`, `POST /api/cidr/split`, `POST /api/cidr/merge`, `GET /api/cidr/next-free`. Todos exigem auth.

### Infra
- Workflow `docker-publish.yml` agora faz skip elegante quando os secrets `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` não estão configurados — sem mais runs vermelhos. Quando os secrets forem configurados, a próxima release publica automaticamente.

---

## [0.3.0] — 2026-05-27

**Tema:** Prometheus discovery, hardening de segurança e response à comunidade.

Release que responde aos primeiros feedbacks do lançamento no LinkedIn e endurece os defaults de segurança que estavam frouxos na v0.2.0.

### Segurança
- **JWT_SECRET é fail-closed.** API recusa boot se a variável estiver vazia, com menos de 32 chars ou contiver os placeholders de exemplo (`please-change`, `change-me`, `dev-secret`). Tokens forjáveis eram risco real em deploys que esqueciam de configurar.
- **Senha de bootstrap admin não tem mais fallback hardcoded** (`admin123`). Se `BOOTSTRAP_ADMIN_PASSWORD` não vier do env, uma senha aleatória forte é gerada no primeiro boot e impressa UMA vez no log do container (anote dali). Se vier mas com <10 chars, boot falha.
- **Defaults removidos do `docker-compose.yml`.** Tokens (`ADMIN_TOKEN`, `INGEST_TOKEN`, `JWT_SECRET`) e senha de admin não têm mais valores padrão inseguros — o operador define no `.env`.
- `.env.example` reescrito com instruções claras de geração de segredos.

### Adicionado
- **Prometheus discovery** ([#25](https://github.com/fabgcruz/bagre/issues/25)) — nova integração que consome `GET /api/v1/targets` do Prometheus, extrai IPs/hostnames dos labels (`__address__`, `instance`, `job`), e empurra para o mesmo pipeline de pending discoveries do Zabbix. Auth `none` / `bearer` / `basic`. Página admin em `/admin/integrations/prometheus`, surface no painel "Integrações". Scheduler periódico configurável.
- Pipeline de discovery extraído pra módulo compartilhado (`apps/api/src/integrations/discovery.js`) — qualquer integração futura (SNMP, Nmap, etc) reutiliza `applyDiscoveries(source, items)`.
- Catálogo de VLANs agora aceita campo `provider` (string livre) — usuário identifica o datacenter/colo (Equinix, Ascenty, ODATA, próprio, etc).
- Audit log: labels para `datacenter_vlan`, `cloud_account`, `zabbix_config`, `prometheus_config`, `oidc_config`.
- **Catálogos → abas dinâmicas por cloud account conectado.** A aba "Azure Subnets" estática saiu; em seu lugar uma aba por CloudAccount ativo, listando subnets sincronizadas em tempo real (com CIDR, region, contagem de IPs e link direto pra subnet no Bagre). Refresh automático a cada 30s.
- Endpoint `GET /api/cloud-accounts/:id/subnets` retornando as subnets sincronizadas de uma conta cloud.

### Documentação / processo
- **CONTRIBUTING.md** novo ([#4](https://github.com/fabgcruz/bagre/issues/4)) — fluxo, convenções, onde achar coisas.
- **SECURITY.md** novo ([#5](https://github.com/fabgcruz/bagre/issues/5)) — política de divulgação privada via GitHub Security Advisories, processo de resposta, boas práticas para operadores.
- **Issue templates** em `.github/ISSUE_TEMPLATE/` ([#6](https://github.com/fabgcruz/bagre/issues/6)) — formulários estruturados para bug e feature, com links contextuais para Discussions e Security Advisories.
- **docs.html regenerada** ([#3](https://github.com/fabgcruz/bagre/issues/3)) — versão navegável dos guias `docs/*.md` em um único HTML.

### Mudado
- **Refactor `EquinixVlan` → `DatacenterVlan`** ([#8](https://github.com/fabgcruz/bagre/issues/8) / [#23](https://github.com/fabgcruz/bagre/issues/23)) — catálogo agora é neutro em relação ao provider de datacenter. Endpoints renomeados de `/api/equinix-vlans` para `/api/datacenter-vlans`, schema model `EquinixVlan` virou `DatacenterVlan` com novo campo `provider`. Importer aceita `datacenter_vlans` (novo) ou `equinix_vlans` (legacy) no seed JSON pra compatibilidade.
- Sidebar reorganizada: "Documentação API" virou item admin (abaixo de Auditoria), "Conexões" voltou a se chamar "Integrações" (agora não confunde porque a doc da API está em seção separada).
- Rota `/integrations` agora exige perfil ADMIN.
- **Hero FinOps refatorado para framing de auditoria, não de "celebração".** Três estados explícitos: sem dados (cinza neutro, CTA pra conectar), zero ociosos (verde com nota pra re-sync), N ociosos (âmbar com "avalie caso a caso — alguns são propositais").
- Sidebar admin agora inclui "Cloud Accounts" entre Integrações e Aprovações.

### Removido
- **Feature de Firewall Rules** — fora do escopo IPAM (NetBox e ferramentas dedicadas fazem isso melhor). Página, rotas, model `FirewallRule`, importer block, item no menu — tudo apagado. Classificação "Firewall" como tipo de equipamento (FortiGate etc) permanece.

### Infra
- `.dockerignore` em `apps/api` e `apps/web` corta context transfer do build (de 24MB pra ~poucos KB), acelera CI.
- Pipeline CI (GitHub Actions): `apps/api` instala + `prisma generate` + syntax check; `apps/web` instala + `vite build` em PRs e push.
- Pipeline de publish: workflow `docker-publish.yml` constrói multi-arch (amd64+arm64) e empurra `bagre-api` + `bagre-web` pro Docker Hub a cada GitHub Release publicada. Requer secrets `DOCKERHUB_USERNAME` e `DOCKERHUB_TOKEN`.

### Issues fechadas nesta release
#1, #2, #3, #4, #5, #6, #7, #8, #19, #22, #23, #25

---

## [0.2.0] — 2026-05-27

**Tema:** Cloud sync (AWS) + FinOps idle public IPs.

Primeira entrega significativa pós-lançamento. O Bagre passa a conectar contas cloud e mostrar IPs públicos ociosos sangrando custo.

### Adicionado
- **Cloud Accounts (AWS)** — nova página admin em `/admin/cloud-accounts`. Conecta conta AWS via Access Key (IAM User) ou Assume Role (STS). Sincroniza VPCs, subnets, ENIs e Elastic IPs.
- **Modos de auth AWS**: `ACCESS_KEY` (IAM User read-only) e `ASSUME_ROLE` (STS:AssumeRole com external ID opcional).
- **FinOps — IPs públicos ociosos**: endpoint `GET /api/cloud/finops/idle-public-ips` + UI hero card com USD/mês estimado + drill-down table. Atualiza a cada 30s.
- **Pool sintético de Public IPs** — Elastic IPs unassociated agora têm bucket dedicado (`<provider>-public-pool`), base do FinOps.
- **Per-account site sintético** (`cloud-<provider>-<accountId>`) isolando múltiplas contas do mesmo provider.
- Schema: models `CloudAccount`, `CloudSyncRun`; enums `IpKind`, `CloudProvider`, `CloudSyncMode`, `CloudSyncStatus`. `Subnet` e `IpAddress` ganham campos opcionais de tracking cloud (`source`, `cloudAccountId`, `cloudResourceId`, `cloudMetadata`, `ipKind`).
- Encryption AES-256-GCM pra credenciais cloud no DB (módulo `integrations/cloud/crypto.js`). Requer `CLOUD_CREDS_KEY` no `.env`.
- Mascote do Bagre (catfish com boné "BAGRE") como ícone do app + favicon. Branding único em todas as telas (login, signup, reset, sidebar).
- Badges no README: release, CI, license, stars, issues, contributors, last commit, PRs welcome.
- Wiki básica em `docs/` com tutoriais (instalação, uso diário, integrações, API REST, operação).

### Removido
- **Feature de Firewall Rules** — fora do escopo de IPAM. Página, rotas, model `FirewallRule`, importer block, link no menu — tudo removido. Classificação "Firewall" como tipo de equipamento (FortiGate etc) permanece, é coisa diferente.

### Corrigido
- `docker compose up -d` agora funciona em clone fresh (antes nginx crash-loopava sem certs TLS, e a API explodia tentando ler `seed.json` inexistente como diretório).
- README ajustado pra URL real do repo (não `SEU-USUARIO`).
- Renomeado `CLAUDE.md` → `AGENTS.md` (convenção neutra; remove qualquer referência a ferramenta específica).
- Revisão geral de marca: limpeza de referências legadas em código, docs, seeds, branding e mensagens de commit.

---

## [0.1.0] — 2026-05-16

Versão inicial publicada após o fork pra opensource.

### Adicionado
- Stack core: Node.js 20 + Fastify + Prisma + PostgreSQL 15 + React + Vite + Tailwind, orquestrado por Docker Compose.
- Catálogo central de sites, subnets (CIDR) e endereços IP.
- Alocação manual ou automática de IPs respeitando o range da subnet.
- Importação de inventários em XLSX/CSV.
- Trilha de auditoria com diff antes/depois.
- Login local + SSO via OIDC (Microsoft Entra ID, Keycloak).
- RBAC com perfis ADMIN/READER.
- Integração com Zabbix para descoberta automática de hosts (puxa MAC, OS, vendor, model).
- Endpoint `/metrics` em formato Prometheus.
- API REST documentada.
- Wiki integrada opcional via DokuWiki.
- ROADMAP público com 4 fases até a 1.0.0.

[Unreleased]: https://github.com/fabgcruz/bagre/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/fabgcruz/bagre/releases/tag/v0.5.0
[0.4.0]: https://github.com/fabgcruz/bagre/releases/tag/v0.4.0
[0.3.2]: https://github.com/fabgcruz/bagre/releases/tag/v0.3.2
[0.3.1]: https://github.com/fabgcruz/bagre/releases/tag/v0.3.1
[0.3.0]: https://github.com/fabgcruz/bagre/releases/tag/v0.3.0
[0.2.0]: https://github.com/fabgcruz/bagre/releases/tag/v0.2.0
[0.1.0]: https://github.com/fabgcruz/bagre/commit/5815508
