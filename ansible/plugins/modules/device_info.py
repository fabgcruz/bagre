#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: device_info
short_description: Lista devices do Bagre IPAM
version_added: "1.0.0"
description:
  - Retorna os devices, com filtros opcionais.
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
options:
  q:
    description: Busca textual (nome, tipo, etc).
    type: str
  site_id:
    description: Filtra por ID de site.
    type: int
  type:
    description: Filtra por tipo de device.
    type: str
  vendor:
    description: Filtra por fabricante.
    type: str
'''

EXAMPLES = r'''
- name: Lista servidores do site 1
  bagre.ipam.device_info:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
    site_id: 1
  register: out
'''

RETURN = r'''
devices:
  description: Lista de devices.
  type: list
  elements: dict
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, run_info,
)


def main():
    argument_spec = bagre_argument_spec()
    argument_spec.update(dict(
        q=dict(type='str'),
        site_id=dict(type='int'),
        type=dict(type='str'),
        vendor=dict(type='str'),
    ))
    module = AnsibleModule(argument_spec=argument_spec, supports_check_mode=True)
    run_info(module, dict(
        list_path='/devices',
        return_key='devices',
        filter_keys=['q', 'site_id', 'type', 'vendor'],
        field_map={'site_id': 'siteId'},
    ))


if __name__ == '__main__':
    main()
