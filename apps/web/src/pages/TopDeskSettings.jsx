import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Save, RefreshCcw, CheckCircle2, AlertCircle, Power, Eye, Ticket, ListChecks } from 'lucide-react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

export default function TopDeskSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg, isLoading } = useQuery({ queryKey: ['topdesk-config'], queryFn: api.topDeskConfig });
  const [form, setForm] = useState(null);
  const [templates, setTemplates] = useState(null);

  useEffect(() => {
    if (cfg && !form) {
      setForm({
        enabled: cfg.enabled,
        baseUrl: cfg.baseUrl || '',
        username: cfg.username || '',
        password: '',
        assetTemplateId: cfg.assetTemplateId || '',
        ipFieldId: cfg.ipFieldId || '',
        hostnameFieldId: cfg.hostnameFieldId || '',
        intervalMinutes: cfg.intervalMinutes ?? 60,
      });
    }
  }, [cfg, form]);

  const save = useMutation({
    mutationFn: api.updateTopDeskConfig,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['topdesk-config'] }); toast.success('Configurações salvas.'); },
    onError: (e) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: api.testTopDeskConfig,
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['topdesk-config'] }); r.ok ? toast.success(r.message) : toast.error(r.message); },
    onError: (e) => toast.error(e.message),
  });
  const loadTemplates = useMutation({
    mutationFn: api.topDeskTemplates,
    onSuccess: (r) => { setTemplates(r.templates || []); toast.success(`${(r.templates || []).length} templates carregados`); },
    onError: (e) => toast.error(e.message),
  });
  const previewMut = useMutation({
    mutationFn: api.topDeskPreview,
    onError: (e) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: api.syncTopDesk,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['topdesk-config'] });
      const base = `Sync ok — criados ${r.created}, atualizados ${r.updated}`;
      r.errors?.length ? toast.error(`${base} · ${r.errors.length} erro(s)`) : toast.success(base);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !form) return null;

  function update(k, v) { setForm((f) => ({ ...f, [k]: v })); }
  function onSave(e) {
    e.preventDefault();
    const payload = { ...form };
    if (!payload.password) delete payload.password;
    payload.hostnameFieldId = payload.hostnameFieldId || null;
    save.mutate(payload);
  }

  const canPreview = !!cfg.assetTemplateId && !!cfg.ipFieldId;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="TopDesk (ITSM)"
        description="Publique os IPs e hosts do inventário como Ativos (CIs) na gestão de ativos do TopDesk — sua CMDB sempre em dia."
      />

      <div className="card p-4 mb-5 border-l-4 border-l-blue-500 bg-blue-50/40 dark:bg-blue-900/10">
        <div className="flex gap-3">
          <Ticket size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-navy-900 dark:text-white">A vantagem:</span> o Bagre já sabe qual host
            pertence a cada IP. Em vez de cadastrar CI na mão no TopDesk, ele cria e mantém os ativos no
            <span className="font-medium"> Asset Management</span> automaticamente. Para segurança, tudo vive num
            <span className="font-medium"> template dedicado</span> — o Bagre só mexe nos ativos que ele mesmo gerencia,
            e seus CIs manuais ficam intactos. O fluxo é <span className="font-medium">preview do diff → aplicar</span>,
            sem escrita automática.
          </div>
        </div>
      </div>

      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Estado</h2>
              {cfg.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200"><Power size={11} /> ativo</span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600 border border-slate-200"><Power size={11} /> inativo</span>
              )}
            </div>
            <div className="mt-2 text-xs text-slate-500 space-y-0.5">
              {cfg.lastTestedAt && (
                <div className="flex items-center gap-1">
                  {cfg.lastTestStatus === 'ok' ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertCircle size={12} className="text-rose-600" />}
                  Último teste: {cfg.lastTestMessage || '—'}
                </div>
              )}
              {cfg.lastSyncAt && (
                <div className="flex items-center gap-1">
                  {cfg.lastSyncStatus === 'ok' ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertCircle size={12} className="text-rose-600" />}
                  Última sync: {new Date(cfg.lastSyncAt).toLocaleString('pt-BR')} · {cfg.lastSyncMessage || '—'}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <button onClick={() => test.mutate()} disabled={test.isPending || !cfg.baseUrl}
              className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50">
              <Activity size={12} /> Testar conexão
            </button>
            <button onClick={() => previewMut.mutate()} disabled={previewMut.isPending || !canPreview}
              className="text-xs px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50">
              <Eye size={12} /> Preview diff
            </button>
            <button onClick={() => { if (confirm('Aplicar sync no TopDesk agora? Vai criar/atualizar ativos no Asset Management.')) sync.mutate(); }} disabled={sync.isPending || !canPreview}
              className="btn-primary text-xs inline-flex items-center gap-1 disabled:opacity-50">
              <RefreshCcw size={12} className={sync.isPending ? 'animate-spin' : ''} />
              {sync.isPending ? 'Sincronizando…' : 'Sync agora'}
            </button>
          </div>
        </div>
      </div>

      {previewMut.data && (
        <div className="card p-4 mb-5">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
            Preview do diff · {previewMut.data.managedCount} ativos gerenciados
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-emerald-200 bg-emerald-50/30 dark:bg-emerald-900/10 p-2">
              <div className="text-xs text-slate-500">Ativos a criar</div>
              <div className="text-2xl font-semibold text-emerald-700 tabular-nums">{previewMut.data.toCreate.length}</div>
            </div>
            <div className="rounded border border-amber-200 bg-amber-50/30 dark:bg-amber-900/10 p-2">
              <div className="text-xs text-slate-500">Ativos a atualizar</div>
              <div className="text-2xl font-semibold text-amber-700 tabular-nums">{previewMut.data.toUpdate.length}</div>
            </div>
          </div>
          {previewMut.data.toCreate.length === 0 && previewMut.data.toUpdate.length === 0 && (
            <p className="text-xs text-slate-500 mt-2">Tudo já sincronizado.</p>
          )}
        </div>
      )}

      <form onSubmit={onSave} className="card p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">URL do TopDesk</label>
          <input className="input w-full font-mono text-sm" placeholder="https://empresa.topdesk.net" value={form.baseUrl} onChange={(e) => update('baseUrl', e.target.value)} />
          <p className="text-[11px] text-slate-500 mt-1">Sem o caminho da API — o Bagre acrescenta <code>/tas/api/assetmgmt</code>.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Usuário da API</label>
            <input className="input w-full text-sm" placeholder="operador-api" value={form.username} onChange={(e) => update('username', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Application password</label>
            <input type="password" className="input w-full font-mono text-sm" placeholder={cfg.hasPassword ? '(salva — deixe vazio pra manter)' : '••••••••'} value={form.password} onChange={(e) => update('password', e.target.value)} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-600">Template dedicado (conjunto gerenciado)</label>
            <button type="button" onClick={() => loadTemplates.mutate()} disabled={loadTemplates.isPending || !cfg.baseUrl}
              className="text-[11px] px-2 py-0.5 rounded border border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-50">
              <ListChecks size={11} /> {loadTemplates.isPending ? 'Carregando…' : 'Carregar templates'}
            </button>
          </div>
          {templates ? (
            <select className="input w-full text-sm" value={form.assetTemplateId} onChange={(e) => update('assetTemplateId', e.target.value)}>
              <option value="">— selecione —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
              ))}
            </select>
          ) : (
            <input className="input w-full font-mono text-sm" placeholder="ID do template (ou carregue a lista acima)" value={form.assetTemplateId} onChange={(e) => update('assetTemplateId', e.target.value)} />
          )}
          <p className="text-[11px] text-slate-500 mt-1">Crie um template só para os ativos vindos do Bagre. Tudo dele é considerado gerenciado — o Bagre nunca toca em CIs de outros templates.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Campo do IP</label>
            <input className="input w-full font-mono text-sm" placeholder="ip-address" value={form.ipFieldId} onChange={(e) => update('ipFieldId', e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Campo do hostname (opcional)</label>
            <input className="input w-full font-mono text-sm" placeholder="hostname" value={form.hostnameFieldId} onChange={(e) => update('hostnameFieldId', e.target.value)} />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">Nomes internos dos campos do seu template no TopDesk (definidos no designer de templates).</p>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Intervalo sugerido (min)</label>
          <input type="number" min="5" className="input w-full text-sm" value={form.intervalMinutes} onChange={(e) => update('intervalMinutes', Number(e.target.value))} />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={(e) => update('enabled', e.target.checked)} className="accent-brand-600" />
          <span className="text-sm">Integração ativa</span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="submit" disabled={save.isPending} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
            <Save size={14} /> {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  );
}
