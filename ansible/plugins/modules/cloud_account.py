#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: cloud_account
short_description: Gerencia contas cloud (AWS/Azure/GCP) no Bagre IPAM
version_added: "1.0.0"
description:
  - Cria, atualiza ou remove uma conta cloud usada para sincronizar subnets/IPs
    de AWS, Azure ou GCP.
  - Idempotente pela chave única O(display_name).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  display_name:
    description: Nome de exibição único da conta, ex. V(Prod AWS).
    type: str
    required: true
  provider:
    description: Provedor de nuvem. Obrigatório ao criar.
    type: str
    choices: [AWS, AZURE, GCP]
  scope:
    description: Escopo/identificador da conta (ex. account id).
    type: str
  regions:
    description: Lista de regiões a sincronizar.
    type: list
    elements: str
  credentials_enc:
    description: Credenciais (serão armazenadas cifradas pelo Bagre).
    type: str
  sync_mode:
    description: Modo de sincronização.
    type: str
    choices: [READ_ONLY, READ_WRITE]
    default: READ_ONLY
  poll_interval_min:
    description: Intervalo de polling em minutos.
    type: int
  state:
    description: Se a conta deve existir (V(present)) ou não (V(absent)).
    type: str
    choices: [present, absent]
    default: present
'''

EXAMPLES = r'''
- name: Conecta uma conta AWS de produção
  bagre.ipam.cloud_account:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    display_name: Prod AWS
    provider: AWS
    scope: "123456789012"
    regions: [us-east-1, sa-east-1]
    sync_mode: READ_ONLY
    poll_interval_min: 15
    state: present
'''

RETURN = r'''
resource:
  description: A conta cloud após a operação (ou null se removida).
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
        display_name=dict(type='str', required=True),
        provider=dict(type='str', choices=['AWS', 'AZURE', 'GCP']),
        scope=dict(type='str'),
        regions=dict(type='list', elements='str'),
        credentials_enc=dict(type='str', no_log=True),
        sync_mode=dict(type='str', default='READ_ONLY',
                       choices=['READ_ONLY', 'READ_WRITE']),
        poll_interval_min=dict(type='int'),
        state=dict(type='str', default='present', choices=['present', 'absent']),
    ))

    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)

    resource = dict(
        name='cloud_account',
        list_path='/cloud-accounts',
        create_path='/cloud-accounts',
        item_path='/cloud-accounts/{id}',
        match_keys=['display_name'],
        create_keys=['provider', 'display_name', 'scope', 'regions',
                     'credentials_enc', 'sync_mode', 'poll_interval_min'],
        update_keys=['scope', 'regions', 'sync_mode', 'poll_interval_min'],
        field_map={'display_name': 'displayName', 'credentials_enc': 'credentialsEnc',
                   'sync_mode': 'syncMode', 'poll_interval_min': 'pollIntervalMin'},
    )
    run_resource(module, resource)


if __name__ == '__main__':
    main()
