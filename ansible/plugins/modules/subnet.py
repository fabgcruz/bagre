#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: subnet
short_description: Gerencia subnets (redes CIDR) no Bagre IPAM
version_added: "1.0.0"
description:
  - Cria, atualiza ou remove uma subnet. Ao criar com um CIDR IPv4, o Bagre
    expande automaticamente os IPs (até 4096 por subnet).
  - Idempotente pela chave única O(cidr). O CIDR não pode ser alterado após criado.
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  cidr:
    description: Rede em notação CIDR, ex. V(10.150.5.0/24).
    type: str
    required: true
  site_id:
    description: ID do site ao qual a subnet pertence. Obrigatório ao criar.
    type: int
  name:
    description: Nome da subnet, ex. V(LAN-PROD).
    type: str
  vlan_id:
    description: ID da VLAN associada.
    type: int
  description:
    description: Descrição livre.
    type: str
  state:
    description: Se a subnet deve existir (V(present)) ou não (V(absent)).
    type: str
    choices: [present, absent]
    default: present
'''

EXAMPLES = r'''
- name: Cria a subnet de produção no site 1
  bagre.ipam.subnet:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    site_id: 1
    name: LAN-PROD
    cidr: 10.150.5.0/24
    vlan_id: 510
    state: present
'''

RETURN = r'''
resource:
  description: A subnet após a operação (ou null se removida).
  type: dict
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, run_resource, subnets_list_fn,
)


def main():
    argument_spec = bagre_argument_spec()
    argument_spec.update(dict(
        cidr=dict(type='str', required=True),
        site_id=dict(type='int'),
        name=dict(type='str'),
        vlan_id=dict(type='int'),
        description=dict(type='str'),
        state=dict(type='str', default='present', choices=['present', 'absent']),
    ))

    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)

    resource = dict(
        name='subnet',
        list_fn=subnets_list_fn,
        create_path='/subnets',
        item_path='/subnets/{id}',
        match_keys=['cidr'],
        create_keys=['site_id', 'name', 'cidr', 'vlan_id', 'description'],
        update_keys=['name', 'vlan_id', 'description'],
        field_map={'site_id': 'siteId', 'vlan_id': 'vlanId'},
    )
    run_resource(module, resource)


if __name__ == '__main__':
    main()
