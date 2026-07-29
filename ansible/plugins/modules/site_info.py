#!/usr/bin/python
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

DOCUMENTATION = r'''
---
module: site_info
short_description: Lista sites do Bagre IPAM
version_added: "1.0.0"
description:
  - Retorna todos os sites (com subnets aninhadas).
author:
  - Fabricio Cruz (@fabgcruz)
extends_documentation_fragment:
  - bagre.ipam.bagre
'''

EXAMPLES = r'''
- name: Lista os sites
  bagre.ipam.site_info:
    endpoint: https://ipam.example.com
    token: "{{ bagre_token }}"
  register: out

- ansible.builtin.debug:
    var: out.sites
'''

RETURN = r'''
sites:
  description: Lista de sites.
  type: list
  elements: dict
  returned: success
'''

from ansible.module_utils.basic import AnsibleModule
from ansible_collections.bagre.ipam.plugins.module_utils.bagre import (
    bagre_argument_spec, run_info,
)


def main():
    module = AnsibleModule(argument_spec=bagre_argument_spec(),
                           supports_check_mode=True)
    run_info(module, dict(list_path='/sites', return_key='sites'))


if __name__ == '__main__':
    main()
