# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
name: next_free_ip
author: Fabricio Cruz (@fabgcruz)
version_added: "1.0.0"
short_description: Retorna o próximo IP livre de uma ou mais subnets do Bagre
description:
  - Recebe CIDRs de subnets como termos e retorna o próximo IP livre de cada uma.
options:
  _terms:
    description: Um ou mais CIDRs de subnet, ex. V(10.150.5.0/24).
    required: true
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
'''

EXAMPLES = r'''
- name: Aloca o próximo IP livre em uma variável
  ansible.builtin.set_fact:
    novo_ip: "{{ lookup('bagre.ipam.next_free_ip', '10.150.5.0/24') }}"
  environment:
    BAGRE_ENDPOINT: https://ipam.example.com
    BAGRE_TOKEN: "{{ bagre_token }}"
'''

RETURN = r'''
_raw:
  description: Lista com o próximo IP livre (address) de cada subnet informada.
  type: list
  elements: str
'''

from ansible.errors import AnsibleError
from ansible.plugins.lookup import LookupBase
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    BagreClient, BagreError, subnets_list_fn,
)


class LookupModule(LookupBase):

    def run(self, terms, variables=None, **kwargs):
        self.set_options(var_options=variables, direct=kwargs)
        client = BagreClient(
            endpoint=self.get_option('endpoint'),
            token=self.get_option('token'),
            validate_certs=self.get_option('validate_certs'),
            timeout=self.get_option('timeout'),
        )
        try:
            subnets = subnets_list_fn(client)
            by_cidr = dict((str(sn.get('cidr')), sn.get('id')) for sn in subnets)
            results = []
            for term in terms:
                subnet_id = by_cidr.get(str(term))
                if subnet_id is None:
                    raise AnsibleError("Subnet com CIDR '{0}' não encontrada.".format(term))
                ip = client.get('/subnets/{0}/next-free-ip'.format(subnet_id))
                address = ip.get('address') if isinstance(ip, dict) else ip
                if not address:
                    raise AnsibleError("Sem IP livre na subnet '{0}'.".format(term))
                results.append(address)
            return results
        except BagreError as e:
            raise AnsibleError(str(e))
