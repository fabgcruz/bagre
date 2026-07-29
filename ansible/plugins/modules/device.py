#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: device
short_description: Gerencia devices (equipamentos/hosts) no Bagre IPAM
version_added: "1.0.0"
description:
  - Cria, atualiza ou remove um device (servidor, switch, host) no Bagre.
  - Idempotente pela chave única O(name).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  name:
    description: Nome único do device, ex. V(srv-prod-01).
    type: str
    required: true
  type:
    description: Tipo do device, ex. V(Servidor Linux).
    type: str
  vendor:
    description: Fabricante, ex. V(Dell).
    type: str
  model:
    description: Modelo, ex. V(PowerEdge R740).
    type: str
  serial:
    description: Número de série.
    type: str
  os_info:
    description: Sistema operacional, ex. V(Ubuntu 22.04).
    type: str
  role:
    description: Função/papel, ex. V(Web Server).
    type: str
  site_id:
    description: ID do site onde o device está.
    type: int
  owner_email:
    description: E-mail do responsável.
    type: str
  notes:
    description: Observações livres.
    type: str
  state:
    description: Se o device deve existir (V(present)) ou não (V(absent)).
    type: str
    choices: [present, absent]
    default: present
'''

EXAMPLES = r'''
- name: Registra um servidor
  bagre.ipam.device:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    name: srv-prod-01
    type: Servidor Linux
    vendor: Dell
    model: PowerEdge R740
    os_info: Ubuntu 22.04
    role: Web Server
    site_id: 1
    state: present
'''

RETURN = r'''
resource:
  description: O device após a operação (ou null se removido).
  type: dict
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, run_resource,
)


def main():
    argument_spec = bagre_argument_spec()
    argument_spec.update(dict(
        name=dict(type='str', required=True),
        type=dict(type='str'),
        vendor=dict(type='str'),
        model=dict(type='str'),
        serial=dict(type='str'),
        os_info=dict(type='str'),
        role=dict(type='str'),
        site_id=dict(type='int'),
        owner_email=dict(type='str'),
        notes=dict(type='str'),
        state=dict(type='str', default='present', choices=['present', 'absent']),
    ))

    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)

    resource = dict(
        name='device',
        list_path='/devices',
        create_path='/devices',
        item_path='/devices/{id}',
        match_keys=['name'],
        create_keys=['name', 'type', 'vendor', 'model', 'serial',
                     'os_info', 'role', 'site_id', 'owner_email', 'notes'],
        update_keys=['type', 'vendor', 'model', 'serial',
                     'os_info', 'role', 'site_id', 'owner_email', 'notes'],
        field_map={'os_info': 'osInfo', 'site_id': 'siteId',
                   'owner_email': 'ownerEmail'},
    )
    run_resource(module, resource)


if __name__ == '__main__':
    main()
