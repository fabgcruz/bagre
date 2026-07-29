#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: ip
short_description: Reserva, libera ou atualiza um endereço IP no Bagre IPAM
version_added: "1.0.0"
description:
  - Opera sobre um IP existente de uma subnet. Os IPs são criados automaticamente
    quando a subnet IPv4 é criada; este módulo altera o estado/metadados deles.
  - Localize a subnet por O(subnet_id) ou O(subnet_cidr) e o IP por O(address).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  address:
    description: Endereço IP alvo, ex. V(10.150.5.20).
    type: str
    required: true
  subnet_id:
    description: ID da subnet que contém o IP.
    type: int
  subnet_cidr:
    description: CIDR da subnet que contém o IP (alternativa a O(subnet_id)).
    type: str
  hostname:
    description: Hostname associado ao IP (usado quando O(state=present)).
    type: str
  type:
    description: Tipo do host (ex. Servidor).
    type: str
  function:
    description: Função do host (ex. Web).
    type: str
  notes:
    description: Observações.
    type: str
  mac_address:
    description: Endereço MAC.
    type: str
  state:
    description:
      - V(present) atualiza os metadados (o Bagre infere status USED).
      - V(reserved) marca o IP como reservado.
      - V(released) libera o IP (status FREE, limpa metadados).
    type: str
    choices: [present, reserved, released]
    default: present
'''

EXAMPLES = r'''
- name: Reserva um IP para uso futuro
  bagre.ipam.ip:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    subnet_cidr: 10.150.5.0/24
    address: 10.150.5.20
    state: reserved

- name: Atribui hostname e função a um IP
  bagre.ipam.ip:
    subnet_id: 12
    address: 10.150.5.20
    hostname: srv-web-01
    type: Servidor
    function: Web
    state: present

- name: Libera um IP
  bagre.ipam.ip:
    subnet_cidr: 10.150.5.0/24
    address: 10.150.5.20
    state: released
'''

RETURN = r'''
resource:
  description: O IP após a operação.
  type: dict
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible.module_utils.common.text.converters import to_native
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, BagreClient, BagreError, subnets_list_fn,
)

_FIELD_MAP = {
    'hostname': 'hostname', 'type': 'type', 'function': 'function',
    'notes': 'notes', 'mac_address': 'macAddress',
}


def _resolve_subnet_id(module, client):
    if module.params.get('subnet_id') is not None:
        return module.params['subnet_id']
    cidr = module.params.get('subnet_cidr')
    for sn in subnets_list_fn(client):
        if str(sn.get('cidr')) == str(cidr):
            return sn.get('id')
    module.fail_json(msg="Subnet com CIDR '{0}' não encontrada.".format(cidr))


def _find_ip(client, subnet_id, address):
    ips = client.get('/subnets/{0}/ips'.format(subnet_id), query={'q': address})
    for ip in (ips or []):
        if str(ip.get('address')) == str(address):
            return ip
    return None


def main():
    argument_spec = bagre_argument_spec()
    argument_spec.update(dict(
        address=dict(type='str', required=True),
        subnet_id=dict(type='int'),
        subnet_cidr=dict(type='str'),
        hostname=dict(type='str'),
        type=dict(type='str'),
        function=dict(type='str'),
        notes=dict(type='str'),
        mac_address=dict(type='str'),
        state=dict(type='str', default='present',
                   choices=['present', 'reserved', 'released']),
    ))

    module = AnsibleModule(
        argument_spec=argument_spec,
        supports_check_mode=True,
        required_one_of=[['subnet_id', 'subnet_cidr']],
        mutually_exclusive=[['subnet_id', 'subnet_cidr']],
    )

    client = BagreClient.from_module(module)
    address = module.params['address']
    state = module.params['state']
    result = dict(changed=False, resource=None)

    try:
        subnet_id = _resolve_subnet_id(module, client)
        ip = _find_ip(client, subnet_id, address)
        if not ip:
            module.fail_json(
                msg="IP {0} não encontrado na subnet {1}. Em IPv4 os IPs são "
                    "criados junto com a subnet; em IPv6 crie o IP antes."
                    .format(address, subnet_id))

        ip_id = ip['id']

        if state == 'released':
            if ip.get('status') != 'FREE':
                result['changed'] = True
                result['resource'] = ip if module.check_mode else \
                    client.post('/ips/{0}/release'.format(ip_id), data={})
            else:
                result['resource'] = ip
            module.exit_json(**result)

        if state == 'reserved':
            if ip.get('status') != 'RESERVED':
                result['changed'] = True
                result['resource'] = ip if module.check_mode else \
                    client.post('/ips/{0}/reserve'.format(ip_id), data={})
            else:
                result['resource'] = ip
            module.exit_json(**result)

        # state == present -> PATCH metadados
        patch = {}
        for opt, field in _FIELD_MAP.items():
            want = module.params.get(opt)
            if want is not None and str(ip.get(field)) != str(want):
                patch[field] = want
        if patch:
            result['changed'] = True
            if module.check_mode:
                merged = dict(ip)
                merged.update(patch)
                result['resource'] = merged
            else:
                result['resource'] = client.patch('/ips/{0}'.format(ip_id), patch)
        else:
            result['resource'] = ip

        module.exit_json(**result)

    except BagreError as e:
        module.fail_json(msg=to_native(e), status=e.status, body=e.body)


if __name__ == '__main__':
    main()
