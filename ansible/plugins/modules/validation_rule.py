#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: validation_rule
short_description: Gerencia regras de validação de subnets no Bagre IPAM
version_added: "1.0.0"
description:
  - Cria, atualiza ou remove uma regra de validação aplicada na criação de subnets
    (ex. C(no-overlap), C(within-master), C(size-range), C(name-pattern)).
  - Idempotente pela chave única O(name).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  name:
    description: Nome único da regra.
    type: str
    required: true
  rule_type:
    description: Tipo da regra. Obrigatório ao criar.
    type: str
    choices: [no-overlap, within-master, size-range, name-pattern]
  enabled:
    description: Se a regra está habilitada.
    type: bool
    default: true
  scope:
    description: Escopo de aplicação (ex. V(null), V("siteId"), V("provider:aws")).
    type: str
  config:
    description: Configuração específica da regra (objeto livre).
    type: dict
  severity:
    description: Severidade quando a regra falha.
    type: str
    choices: [error, warning]
    default: error
  state:
    description: Se a regra deve existir (V(present)) ou não (V(absent)).
    type: str
    choices: [present, absent]
    default: present
'''

EXAMPLES = r'''
- name: Garante regra global de não-sobreposição
  bagre.ipam.validation_rule:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    name: global-no-overlap
    rule_type: no-overlap
    enabled: true
    severity: error
    state: present
'''

RETURN = r'''
resource:
  description: A regra após a operação (ou null se removida).
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
        rule_type=dict(type='str',
                       choices=['no-overlap', 'within-master',
                                'size-range', 'name-pattern']),
        enabled=dict(type='bool', default=True),
        scope=dict(type='str'),
        config=dict(type='dict'),
        severity=dict(type='str', default='error', choices=['error', 'warning']),
        state=dict(type='str', default='present', choices=['present', 'absent']),
    ))

    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)

    resource = dict(
        name='validation_rule',
        list_path='/validation/rules',
        create_path='/validation/rules',
        item_path='/validation/rules/{id}',
        match_keys=['name'],
        create_keys=['name', 'rule_type', 'enabled', 'scope', 'config', 'severity'],
        update_keys=['enabled', 'scope', 'config', 'severity'],
        field_map={'rule_type': 'ruleType'},
    )
    run_resource(module, resource)


if __name__ == '__main__':
    main()
