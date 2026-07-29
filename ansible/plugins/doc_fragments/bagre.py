# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type


class ModuleDocFragment(object):
    # Opções de conexão comuns a todos os módulos da collection bagre.ipam
    DOCUMENTATION = r'''
options:
  endpoint:
    description:
      - URL base da API do Bagre, ex. C(https://ipam.example.com).
      - Pode ser definida pela variável de ambiente E(BAGRE_ENDPOINT).
    type: str
    required: true
  token:
    description:
      - Token de API do Bagre (formato C(bagre_...)), com escopo C(READ_WRITE)
        para operações de escrita.
      - Pode ser definido pela variável de ambiente E(BAGRE_TOKEN).
    type: str
    required: true
  validate_certs:
    description:
      - Se V(false), não valida o certificado TLS do endpoint.
    type: bool
    default: true
  timeout:
    description:
      - Tempo limite (segundos) das requisições HTTP.
    type: int
    default: 30
'''
