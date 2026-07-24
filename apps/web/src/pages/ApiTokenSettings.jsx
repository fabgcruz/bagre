import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  Plus,
  Trash2,
  Copy,
  Check,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import { api, demoTryWrite } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ApiTokenSettings() {
  const qc = useQueryClient();
  const toast = useToast();

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: api.apiTokens,
  });

  const [form, setForm] = useState({ name: '', scope: 'READ_WRITE', expiresInDays: '' });
  // Plaintext token shown exactly once, right after creation.
  const [freshToken, setFreshToken] = useState(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: api.createApiToken,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      setFreshToken(res.token);
      setForm({ name: '', scope: 'READ_WRITE', expiresInDays: '' });
      toast.success('Token criado. Copie agora — ele não será exibido de novo.');
    },
    onError: (e) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: api.revokeApiToken,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['api-tokens'] });
      toast.success('Token revogado.');
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(e) {
    e.preventDefault();
    if (demoTryWrite()) return;
    if (!form.name.trim()) {
      toast.error('Dê um nome ao token (ex: terraform-ci).');
      return;
    }
    const payload = { name: form.name.trim(), scope: form.scope };
    if (form.expiresInDays !== '' && Number(form.expiresInDays) > 0) {
      payload.expiresInDays = Number(form.expiresInDays);
    }
    create.mutate(payload);
  }

  function onRevoke(t) {
    if (demoTryWrite()) return;
    if (!window.confirm(`Revogar o token "${t.name}" (${t.prefix}…)? Qualquer automação usando-o deixará de funcionar imediatamente.`)) return;
    revoke.mutate(t.id);
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar — selecione e copie manualmente.');
    }
  }

  return (
    <div>
      <PageHeader
        title="Tokens de API"
        description="Credenciais de longa duração para automação — provider Terraform/OpenTofu, operator Kubernetes e scripts de CI. Cada token tem escopo (somente leitura ou leitura/escrita), pode expirar e ser revogado a qualquer momento."
      />

      {/* Token recém-criado: exibido UMA vez */}
      {freshToken && (
        <div className="card p-4 mb-5 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800">
          <div className="flex items-start gap-3">
            <ShieldAlert className="text-emerald-600 shrink-0 mt-0.5" size={18} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                Copie o token agora — ele não será exibido novamente.
              </p>
              <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
                Guardamos apenas o hash. Se perder, gere um novo.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate rounded bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800 px-2 py-1.5 text-xs font-mono">
                  {freshToken}
                </code>
                <button type="button" className="btn-ghost shrink-0" onClick={copyToken}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span className="ml-1">{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
            </div>
            <button
              type="button"
              className="btn-ghost shrink-0"
              onClick={() => setFreshToken(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Criar novo token */}
      <div className="card p-5 mb-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Plus size={15} /> Gerar novo token
        </h2>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Nome</label>
            <input
              className="input w-full"
              placeholder="terraform-ci"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Escopo</label>
            <select
              className="input"
              value={form.scope}
              onChange={(e) => setForm({ ...form, scope: e.target.value })}
            >
              <option value="READ_WRITE">Leitura/Escrita</option>
              <option value="READ_ONLY">Somente leitura</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Expira em (dias)</label>
            <input
              className="input w-28"
              type="number"
              min="1"
              placeholder="nunca"
              value={form.expiresInDays}
              onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            <KeyRound size={14} />
            <span className="ml-1">{create.isPending ? 'Gerando…' : 'Gerar'}</span>
          </button>
        </form>
      </div>

      {/* Lista de tokens */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Carregando…</div>
        ) : tokens.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Nenhum token ainda. Gere um acima para usar o Bagre como source of truth em IaC.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">Identificador</th>
                <th className="px-4 py-2 font-medium">Escopo</th>
                <th className="px-4 py-2 font-medium">Último uso</th>
                <th className="px-4 py-2 font-medium">Expira</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const revoked = !!t.revokedAt;
                const expired = t.expiresAt && new Date(t.expiresAt) <= new Date();
                return (
                  <tr
                    key={t.id}
                    className={`border-b border-slate-50 dark:border-slate-800/50 ${revoked || expired ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-2.5 font-medium">{t.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{t.prefix}…</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs rounded px-1.5 py-0.5 ${t.scope === 'READ_WRITE' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                        {t.scope === 'READ_WRITE' ? 'Leitura/Escrita' : 'Somente leitura'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{fmtDate(t.lastUsedAt)}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{t.expiresAt ? fmtDate(t.expiresAt) : 'nunca'}</td>
                    <td className="px-4 py-2.5">
                      {revoked ? (
                        <span className="text-xs text-rose-600">Revogado</span>
                      ) : expired ? (
                        <span className="text-xs text-rose-600">Expirado</span>
                      ) : (
                        <span className="text-xs text-emerald-600">Ativo</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!revoked && (
                        <button
                          type="button"
                          className="btn-ghost text-rose-600"
                          onClick={() => onRevoke(t)}
                          title="Revogar"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Dica de uso */}
      <div className="card p-5 mt-5">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Terminal size={15} /> Como usar
        </h2>
        <p className="text-xs text-slate-500 mb-3">
          Use o token no header <code>Authorization: Bearer &lt;token&gt;</code>, ou via variáveis de
          ambiente no provider Terraform/OpenTofu:
        </p>
        <pre className="rounded bg-slate-900 text-slate-100 text-xs p-3 overflow-x-auto">
{`# variáveis de ambiente
export BAGRE_ENDPOINT="https://ipam.suaempresa.com"
export BAGRE_TOKEN="bagre_…"

# Terraform / OpenTofu
provider "bagre" {
  endpoint  = var.bagre_endpoint  # ou env BAGRE_ENDPOINT
  api_token = var.bagre_token     # ou env BAGRE_TOKEN
}`}
        </pre>
        <p className="text-xs text-slate-400 mt-2">
          Por segurança, tokens de API não podem gerenciar usuários nem outros tokens. Use o menor
          escopo necessário — prefira <strong>Somente leitura</strong> para pipelines que só consultam IPs.
        </p>
      </div>
    </div>
  );
}
