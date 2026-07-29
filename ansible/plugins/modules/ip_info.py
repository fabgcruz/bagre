#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: ip_info
short_description: Lista IPs de uma subnet no Bagre IPAM
version_added: "1.0.0"
description:
  - Retorna os IPs de uma subnet, com filtros opcionais de status e busca.
  - Localize a subnet por O(subnet_id) ou O(subnet_cidr).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  subnet_id:
    description: ID da subnet.
    type: int
  subnet_cidr:
    description: CIDR da subnet (alternativa a O(subnet_id)).
    type: str
  status:
    description: Filtra por status do IP.
    type: str
    choices: [FREE, USED, RESERVED, CONFLICT]
  q:
    description: Busca textual (address, hostname, type, function).
    type: str
'''

EXAMPLES = r'''
- name: Lista IPs livres de uma subnet
  bagre.ipam.ip_info:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    subnet_cidr: 10.150.5.0/24
    status: FREE
  register: out
'''

RETURN = r'''
ips:
  description: Lista de IPs da subnet.
  type: list
  elements: dict
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible.module_utils.common.text.converters import to_native
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, BagreClient, BagreError, subnets_list_fn,
)


def main():
    argument_spec = bagre_argument_spec()
    argument_spec.update(dict(
        subnet_id=dict(type='int'),
        subnet_cidr=dict(type='str'),
        status=dict(type='str',
                    choices=['FREE', 'USED', 'RESERVED', 'CONFLICT']),
        q=dict(type='str'),
    ))

    module = AnsibleModule(
        argument_spec=argument_spec,
        supports_check_mode=True,
        required_one_of=[['subnet_id', 'subnet_cidr']],
        mutually_exclusive=[['subnet_id', 'subnet_cidr']],
    )

    client = BagreClient.from_module(module)
    try:
        subnet_id = module.params.get('subnet_id')
        if subnet_id is None:
            cidr = module.params['subnet_cidr']
            subnet_id = next((sn.get('id') for sn in subnets_list_fn(client)
                              if str(sn.get('cidr')) == str(cidr)), None)
            if subnet_id is None:
                module.fail_json(msg="Subnet com CIDR '{0}' não encontrada.".format(cidr))
        query = {}
        if module.params.get('status'):
            query['status'] = module.params['status']
        if module.params.get('q'):
            query['q'] = module.params['q']
        ips = client.get('/subnets/{0}/ips'.format(subnet_id), query=query or None)
        module.exit_json(changed=False, ips=ips or [])
    except BagreError as e:
        module.fail_json(msg=to_native(e), status=e.status, body=e.body)


if __name__ == '__main__':
    main()
