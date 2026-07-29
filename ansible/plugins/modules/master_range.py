#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: master_range
short_description: Gerencia master ranges (faixas corporativas) no Bagre IPAM
version_added: "1.0.0"
description:
  - Cria, atualiza ou remove um master range — o catálogo de faixas CIDR
    corporativas usadas pela validação C(within-master).
  - Idempotente pela chave única O(cidr).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  cidr:
    description: Faixa em notação CIDR, ex. V(10.0.0.0/8).
    type: str
    required: true
  description:
    description: Descrição da faixa.
    type: str
  category:
    description: Categoria da faixa.
    type: str
    choices: [Datacenter, Cloud, Links, WAN]
  state:
    description: Se a faixa deve existir (V(present)) ou não (V(absent)).
    type: str
    choices: [present, absent]
    default: present
'''

EXAMPLES = r'''
- name: Registra a faixa corporativa 10/8
  bagre.ipam.master_range:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    cidr: 10.0.0.0/8
    description: Faixa privada da empresa
    category: Datacenter
    state: present
'''

RETURN = r'''
resource:
  description: O master range após a operação (ou null se removido).
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
        cidr=dict(type='str', required=True),
        description=dict(type='str'),
        category=dict(type='str',
                      choices=['Datacenter', 'Cloud', 'Links', 'WAN']),
        state=dict(type='str', default='present', choices=['present', 'absent']),
    ))

    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)

    resource = dict(
        name='master_range',
        list_path='/master-ranges',
        create_path='/master-ranges',
        item_path='/master-ranges/{id}',
        match_keys=['cidr'],
        create_keys=['cidr', 'description', 'category'],
        update_keys=['description', 'category'],
    )
    run_resource(module, resource)


if __name__ == '__main__':
    main()
