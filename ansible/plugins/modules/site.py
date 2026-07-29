#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: site
short_description: Gerencia sites (locais/datacenters) no Bagre IPAM
version_added: "1.0.0"
description:
  - Cria, atualiza ou remove um site no Bagre. Um site representa um local
    físico (datacenter, escritório) que agrupa subnets e IPs.
  - A operação é idempotente e usa O(code) como chave única.
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  code:
    description: Código único do site, ex. V(DC1).
    type: str
    required: true
  name:
    description: Nome legível do site. Obrigatório ao criar.
    type: str
  description:
    description: Descrição livre do site.
    type: str
  state:
    description: Se o site deve existir (V(present)) ou não (V(absent)).
    type: str
    choices: [present, absent]
    default: present
'''

EXAMPLES = r'''
- name: Garante que o datacenter DC1 existe
  bagre.ipam.site:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    code: DC1
    name: Data Center 1
    description: Sala cofre - São Paulo
    state: present

- name: Remove um site
  bagre.ipam.site:
    code: DC1
    state: absent
'''

RETURN = r'''
resource:
  description: O site após a operação (ou null se removido).
  type: dict
  returned: success
  sample:
    id: 1
    code: DC1
    name: Data Center 1
    description: Sala cofre - São Paulo
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, run_resource,
)


def main():
    argument_spec = bagre_argument_spec()
    argument_spec.update(dict(
        code=dict(type='str', required=True),
        name=dict(type='str'),
        description=dict(type='str'),
        state=dict(type='str', default='present', choices=['present', 'absent']),
    ))

    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)

    resource = dict(
        name='site',
        list_path='/sites',
        create_path='/sites',
        item_path='/sites/{id}',
        match_keys=['code'],
        create_keys=['code', 'name', 'description'],
        update_keys=['name', 'description'],
    )
    run_resource(module, resource)


if __name__ == '__main__':
    main()
