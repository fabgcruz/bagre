# -*- coding: utf-8 -*-
# Copyright (c) 2026, Fabricio Cruz (@fabgcruz)
# GNU General Public License v3.0+ (see COPYING or https://www.gnu.org/licenses/gpl-3.0.txt)
# SPDX-License-Identifier: GPL-3.0-or-later
from __future__ import absolute_import, division, print_function
__metaclass__ = type

import json

from ansible.module_utils.basic import env_fallback
from ansible.module_utils.urls import open_url
from ansible.module_utils.six.moves.urllib.error import HTTPError, URLError
from ansible.module_utils.six.moves.urllib.parse import urlencode
from ansible.module_utils.common.text.converters import to_native, to_text


def bagre_argument_spec():
    """Argumentos comuns de conexão a todos os módulos/plugins da collection."""
    return dict(
        endpoint=dict(
            type='str', required=True,
            fallback=(env_fallback, ['BAGRE_ENDPOINT']),
        ),
        token=dict(
            type='str', required=True, no_log=True,
            fallback=(env_fallback, ['BAGRE_TOKEN']),
        ),
        validate_certs=dict(type='bool', default=True),
        timeout=dict(type='int', default=30),
    )


class BagreError(Exception):
    def __init__(self, msg, status=None, body=None):
        super(BagreError, self).__init__(msg)
        self.status = status
        self.body = body


class BagreClient(object):
    """Cliente HTTP minimalista para a API REST do Bagre (Bearer token)."""

    def __init__(self, endpoint, token, validate_certs=True, timeout=30):
        self.endpoint = endpoint.rstrip('/')
        self.token = token
        self.validate_certs = validate_certs
        self.timeout = timeout

    @classmethod
    def from_module(cls, module):
        p = module.params
        return cls(p['endpoint'], p['token'],
                   p.get('validate_certs', True), p.get('timeout', 30))

    def _url(self, path, query=None):
        if not path.startswith('/'):
            path = '/' + path
        url = '{0}/api{1}'.format(self.endpoint, path)
        if query:
            clean = dict((k, v) for k, v in query.items() if v is not None)
            if clean:
                url = url + '?' + urlencode(clean)
        return url

    def request(self, method, path, data=None, query=None):
        url = self._url(path, query=query)
        headers = {
            'Authorization': 'Bearer ' + self.token,
            'Accept': 'application/json',
            'User-Agent': 'ansible-collection-bagre',
        }
        body = None
        if data is not None:
            headers['Content-Type'] = 'application/json'
            body = json.dumps(data)
        try:
            resp = open_url(
                url, method=method, data=body, headers=headers,
                validate_certs=self.validate_certs, timeout=self.timeout,
            )
            raw = resp.read()
            return resp.getcode(), self._parse(raw)
        except HTTPError as e:
            raw = e.read()
            parsed = self._parse(raw)
            detail = parsed if parsed else to_native(raw)
            raise BagreError(
                "HTTP {0} em {1} {2}: {3}".format(e.code, method, path, detail),
                status=e.code, body=parsed,
            )
        except URLError as e:
            raise BagreError(
                "Falha de conexão com {0}: {1}".format(url, to_native(e.reason)))

    @staticmethod
    def _parse(raw):
        if not raw:
            return None
        try:
            return json.loads(to_text(raw))
        except ValueError:
            return to_text(raw)

    def get(self, path, query=None):
        return self.request('GET', path, query=query)[1]

    def post(self, path, data):
        return self.request('POST', path, data=data)[1]

    def patch(self, path, data):
        return self.request('PATCH', path, data=data)[1]

    def delete(self, path):
        return self.request('DELETE', path)[1]


def _api_field(resource, option):
    """Traduz um nome de opção Ansible (snake_case) para o campo da API (camelCase)."""
    return resource.get('field_map', {}).get(option, option)


def _build_payload(module, resource, option_names):
    payload = {}
    for opt in option_names:
        if module.params.get(opt) is not None:
            payload[_api_field(resource, opt)] = module.params[opt]
    return payload


def _list_items(client, resource):
    if 'list_fn' in resource:
        return resource['list_fn'](client)
    data = client.get(resource['list_path'])
    if isinstance(data, dict):
        # algumas rotas embrulham a lista numa chave
        for key in ('items', 'data', resource['name'] + 's'):
            if isinstance(data.get(key), list):
                return data[key]
        return []
    return data or []


def _find_existing(module, resource, items):
    match_keys = resource['match_keys']
    for item in items:
        ok = True
        for opt in match_keys:
            want = module.params.get(opt)
            have = item.get(_api_field(resource, opt))
            if want is None or str(have) != str(want):
                ok = False
                break
        if ok:
            return item
    return None


def run_resource(module, resource):
    """Executa CRUD idempotente para um recurso REST simples do Bagre.

    resource = {
        name, list_path/list_fn, create_path, item_path ('/x/{id}'),
        match_keys[], create_keys[], update_keys[], field_map{}, id_field
    }
    """
    client = BagreClient.from_module(module)
    state = module.params['state']
    id_field = resource.get('id_field', 'id')
    result = dict(changed=False, resource=None, diff={})

    try:
        existing = _find_existing(module, resource, _list_items(client, resource))

        if state == 'absent':
            if existing:
                result['changed'] = True
                result['resource'] = existing
                if not module.check_mode:
                    client.delete(resource['item_path'].format(id=existing[id_field]))
                    result['resource'] = None
            module.exit_json(**result)

        # state == present
        if not existing:
            payload = _build_payload(module, resource, resource['create_keys'])
            result['changed'] = True
            result['diff'] = {'before': {}, 'after': payload}
            if module.check_mode:
                result['resource'] = payload
            else:
                result['resource'] = client.post(resource['create_path'], payload)
            module.exit_json(**result)

        # já existe -> calcula diff nos campos atualizáveis
        patch = {}
        before = {}
        for opt in resource['update_keys']:
            want = module.params.get(opt)
            if want is None:
                continue
            field = _api_field(resource, opt)
            have = existing.get(field)
            if str(have) != str(want):
                patch[field] = want
                before[field] = have

        if patch:
            result['changed'] = True
            result['diff'] = {'before': before, 'after': patch}
            if module.check_mode:
                merged = dict(existing)
                merged.update(patch)
                result['resource'] = merged
            else:
                result['resource'] = client.patch(
                    resource['item_path'].format(id=existing[id_field]), patch)
        else:
            result['resource'] = existing

        module.exit_json(**result)

    except BagreError as e:
        module.fail_json(msg=to_native(e), status=e.status, body=e.body)


def run_info(module, resource):
    """Lista recursos, com filtros opcionais mapeados para query params."""
    client = BagreClient.from_module(module)
    try:
        query = None
        if resource.get('filter_keys'):
            query = {}
            for opt in resource['filter_keys']:
                if module.params.get(opt) is not None:
                    query[_api_field(resource, opt)] = module.params[opt]
        if 'list_fn' in resource:
            items = resource['list_fn'](client)
        else:
            items = client.get(resource['list_path'], query=query)
            if isinstance(items, dict):
                items = items.get('items', items)
        module.exit_json(changed=False, **{resource['return_key']: items})
    except BagreError as e:
        module.fail_json(msg=to_native(e), status=e.status, body=e.body)


def subnets_list_fn(client):
    """Achata as subnets aninhadas retornadas por GET /api/sites."""
    sites = client.get('/sites') or []
    out = []
    for site in sites:
        for sn in site.get('subnets', []) or []:
            item = dict(sn)
            item.setdefault('siteId', site.get('id'))
            out.append(item)
    return out
