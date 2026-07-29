# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
name: bagre
author: Fabricio Cruz (@fabgcruz)
version_added: "1.0.0"
short_description: Inventário dinâmico do Bagre IPAM
description:
  - Constrói o inventário do Ansible a partir dos IPs cadastrados no Bagre.
  - Cada IP com hostname vira um host; o endereço vira C(ansible_host).
  - Agrupa automaticamente por site, subnet, tipo e função, e suporta
    O(compose), O(groups) e O(keyed_groups).
extends_documentation_fragment:
  - constructed
  - inventory_cache
options:
  plugin:
    description: Marcador do plugin; deve ser V(bagre.ipam.bagre).
    required: true
    choices: [bagre.ipam.bagre]
  endpoint:
    description: URL base da API do Bagre.
    type: str
    required: true
    env:
      - name: BAGRE_ENDPOINT
  token:
    description: Token de API do Bagre (C(bagre_...)).
    type: str
    required: true
    env:
      - name: BAGRE_TOKEN
  validate_certs:
    description: Valida o certificado TLS.
    type: bool
    default: true
  timeout:
    description: Timeout HTTP em segundos.
    type: int
    default: 30
  statuses:
    description: Quais status de IP incluir no inventário.
    type: list
    elements: str
    default: [USED]
  hostname_var:
    description:
      - Qual campo do IP usar como nome do host (C(hostname) por padrão).
      - Se o IP não tiver esse campo preenchido, ele é ignorado.
    type: str
    default: hostname
'''

EXAMPLES = r'''
# arquivo: inventory.bagre.yml
plugin: bagre.ipam.bagre
endpoint: https://ipam.example.com
# token via variável de ambiente BAGRE_TOKEN
statuses:
  - USED
  - RESERVED
keyed_groups:
  - key: bagre_site
    prefix: site
  - key: bagre_function
    prefix: func
compose:
  ansible_host: bagre_address
'''

from ansible.errors import AnsibleError
from ansible.plugins.inventory import BaseInventoryPlugin, Constructable, Cacheable
from ansible.module_utils.common.text.converters import to_native
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    BagreClient, BagreError,
)


class InventoryModule(BaseInventoryPlugin, Constructable, Cacheable):

    NAME = 'bagre.ipam.bagre'

    def verify_file(self, path):
        if not super(InventoryModule, self).verify_file(path):
            return False
        return path.endswith(('bagre.yml', 'bagre.yaml',
                              'bagre_inventory.yml', 'bagre_inventory.yaml'))

    def _fetch_hosts(self, client, statuses):
        """Retorna [(hostname, host_vars_dict), ...] a partir dos IPs do Bagre."""
        hosts = []
        sites = client.get('/sites') or []
        for site in sites:
            site_code = site.get('code')
            for subnet in site.get('subnets', []) or []:
                sn_id = subnet.get('id')
                ips = client.get('/subnets/{0}/ips'.format(sn_id)) or []
                for ip in ips:
                    if statuses and ip.get('status') not in statuses:
                        continue
                    hostvars = {
                        'bagre_address': ip.get('address'),
                        'bagre_status': ip.get('status'),
                        'bagre_type': ip.get('type'),
                        'bagre_function': ip.get('function'),
                        'bagre_mac': ip.get('macAddress'),
                        'bagre_site': site_code,
                        'bagre_subnet': subnet.get('cidr'),
                        'bagre_notes': ip.get('notes'),
                    }
                    hosts.append((ip, hostvars))
        return hosts

    def parse(self, inventory, loader, path, cache=True):
        super(InventoryModule, self).parse(inventory, loader, path, cache=cache)
        self._read_config_data(path)

        hostname_var = self.get_option('hostname_var')
        statuses = self.get_option('statuses')

        client = BagreClient(
            endpoint=self.get_option('endpoint'),
            token=self.get_option('token'),
            validate_certs=self.get_option('validate_certs'),
            timeout=self.get_option('timeout'),
        )

        try:
            raw_hosts = self._fetch_hosts(client, statuses)
        except BagreError as e:
            raise AnsibleError(to_native(e))

        strict = self.get_option('strict')

        for ip, hostvars in raw_hosts:
            name = ip.get(hostname_var)
            if not name:
                continue
            self.inventory.add_host(name)
            for k, v in hostvars.items():
                self.inventory.set_variable(name, k, v)

            # grupos automáticos por site e subnet
            if hostvars['bagre_site']:
                grp = self.inventory.add_group('site_%s' % self._sanitize(hostvars['bagre_site']))
                self.inventory.add_child(grp, name)
            if hostvars['bagre_function']:
                grp = self.inventory.add_group('func_%s' % self._sanitize(hostvars['bagre_function']))
                self.inventory.add_child(grp, name)

            # constructable: compose / groups / keyed_groups definidos pelo usuário
            self._set_composite_vars(self.get_option('compose'), hostvars, name, strict=strict)
            self._add_host_to_composed_groups(self.get_option('groups'), hostvars, name, strict=strict)
            self._add_host_to_keyed_groups(self.get_option('keyed_groups'), hostvars, name, strict=strict)

    @staticmethod
    def _sanitize(value):
        out = []
        for ch in to_native(value):
            out.append(ch if (ch.isalnum() or ch == '_') else '_')
        return ''.join(out)
