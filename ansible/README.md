# Ansible Collection — `bagre.ipam`

Automatize o [Bagre IPAM](https://bagre.dev) com Ansible: gerencie sites, subnets,
IPs, devices, faixas corporativas, regras de validação e contas cloud — além de um
**inventário dinâmico** e um **lookup de próximo IP livre**.

> Faz par com o [`terraform-provider-bagre`](https://github.com/fabgcruz/terraform-provider-bagre):
> IaC via Terraform, automação operacional via Ansible.

## Requisitos

- `ansible-core` >= 2.15
- Um Bagre acessível e um **token de API** (`bagre_...`) com escopo `READ_WRITE`
  (crie em *Administração → API Tokens* ou via `POST /api/api-tokens`).

## Instalação

```bash
ansible-galaxy collection install bagre.ipam
```

## Configuração

Todos os módulos aceitam `endpoint` e `token`, ou as variáveis de ambiente:

```bash
export BAGRE_ENDPOINT=https://ipam.example.com
export BAGRE_TOKEN=bagre_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Conteúdo

### Módulos

| Módulo | O que faz |
|--------|-----------|
| `bagre.ipam.site` | Cria/atualiza/remove sites (locais/datacenters) |
| `bagre.ipam.subnet` | Cria/atualiza/remove subnets (CIDR) |
| `bagre.ipam.ip` | Reserva/libera/atualiza um IP |
| `bagre.ipam.device` | Cria/atualiza/remove devices (hosts) |
| `bagre.ipam.master_range` | Gerencia faixas corporativas |
| `bagre.ipam.validation_rule` | Gerencia regras de validação de subnets |
| `bagre.ipam.cloud_account` | Gerencia contas AWS/Azure/GCP |
| `bagre.ipam.next_free_ip` | Retorna o próximo IP livre de uma subnet |
| `*_info` | Versões somente-leitura: `site_info`, `subnet_info`, `device_info`, `ip_info` |

### Plugins

| Plugin | Tipo | O que faz |
|--------|------|-----------|
| `bagre.ipam.bagre` | inventory | Inventário dinâmico a partir dos IPs do Bagre |
| `bagre.ipam.next_free_ip` | lookup | Próximo IP livre dentro de uma expressão Jinja |

> **Fora do escopo (por design):** gestão de usuários e de tokens de API não é
> exposta — a API do Bagre bloqueia esses endpoints para tokens de automação
> (só admin autenticado via UI/JWT).

## Exemplo rápido

```yaml
- hosts: localhost
  gather_facts: false
  tasks:
    - name: Garante o site DC1
      bagre.ipam.site:
        code: DC1
        name: Data Center 1

    - name: Garante a subnet de produção
      bagre.ipam.subnet:
        site_id: 1
        name: LAN-PROD
        cidr: 10.150.5.0/24
        vlan_id: 510

    - name: Reserva o próximo IP livre
      bagre.ipam.ip:
        subnet_cidr: 10.150.5.0/24
        address: "{{ lookup('bagre.ipam.next_free_ip', '10.150.5.0/24') }}"
        hostname: srv-web-01
        function: Web
        state: reserved
```

Veja mais em [`playbooks/`](playbooks/).

## Inventário dinâmico

```yaml
# inventory.bagre.yml
plugin: bagre.ipam.bagre
endpoint: https://ipam.example.com
statuses: [USED, RESERVED]
keyed_groups:
  - key: bagre_site
    prefix: site
compose:
  ansible_host: bagre_address
```

```bash
ansible-inventory -i inventory.bagre.yml --graph
```

Cada IP com `hostname` vira um host; grupos `site_*` e `func_*` são criados
automaticamente. Variáveis por host: `bagre_address`, `bagre_status`,
`bagre_type`, `bagre_function`, `bagre_site`, `bagre_subnet`, `bagre_mac`.

## Licença

GPL-3.0-or-later © Fabricio Cruz (padrão das collections Ansible; veja `COPYING`).
O produto Bagre em si permanece sob licença MIT.
